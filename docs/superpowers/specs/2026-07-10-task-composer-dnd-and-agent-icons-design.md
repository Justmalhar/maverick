# Task Composer drag-and-drop + agent icons + attachment launch wiring

## Problem

1. Dragging a file (e.g. a screenshot) onto the Kanban Task Composer does nothing. `TaskComposer.tsx` implements drop handling with native HTML5 `onDragOver`/`onDrop`/`onDragLeave` on the composer `<div>`. Tauri's webview intercepts OS-level file drags before the DOM ever sees them (`dragDropEnabled` defaults to true), so these handlers never fire. This is the same class of bug already fixed for the Terminal panel via `registerFileDropTarget` (`src/lib/file-drop.ts`).
2. The backend/agent `<Select>` in `TaskComposer.tsx` renders `b.name` as plain text. Every other backend picker in the app (`NewWorkspaceDialog`, `WorkspaceItem`, `DashboardView`, `UsagePanel`) renders `brandFor(b.id).Icon` for a proper brand mark. `TaskComposer` never adopted this.

While tracing these, two related pre-existing bugs surfaced in the same code paths and are folded into this fix (approved by user):

3. The file-picker's existing binary-encode path — `btoa(String.fromCharCode(...new Uint8Array(buffer)))` in `processFiles` — spreads the entire byte array as call arguments, which stack-overflows for files over roughly 100KB. Any real screenshot hits this today.
4. Kanban task attachments (image or text, added via the composer or `KanbanTaskDialog`) are persisted on the task row and never used again: `stageLaunch`/`buildLaunchPrompt` only ever send the text prompt to the launched CLI agent. The attached file itself never reaches the agent.
5. `TaskComposer` only calls `fetchBranches` inside a `useEffect` gated on the `defaultProjectId` prop. When the composer mounts without that prop (defaulting `selectedProjectId` to the active workspace's project instead), branches are never fetched, the base-branch `<Select>` stays empty, and `canSend` (which requires `selectedBaseBranch`) never becomes true.

## Scope

In scope:
- Fix drag-and-drop file attach in `TaskComposer` using the existing `registerFileDropTarget` mechanism.
- Fix the `btoa` stack-overflow in the existing click-to-attach path.
- Add brand icons to the backend/agent `<Select>` in `TaskComposer`.
- Materialize kanban task attachments to disk in the workspace's worktree at launch time, and append their paths to the launch prompt so the CLI agent can see them.
- Fix the missing initial branch fetch.

Out of scope:
- Any UI to preview/display attachments inside `KanbanTaskDialog` (they aren't rendered there today, and adding a preview isn't part of this request).
- Changing the 2MB per-attachment size limit or its UX.
- Any change to the Agent-mode (`Composer.tsx`) chat attachment flow — that flow already works correctly (path-reference based, not content-embedding based) and is untouched.

## Design

### Backend: two new minimal RPCs

**`file.readBinary`** (sidecar `FileReader.readBinary`, Rust `file_read_binary`, TS `fileReadBinary`)

```
{ filePath: string } → { content: string /* base64 */, size: number, unreadable: boolean }
```

Reads a file's raw bytes regardless of content type. Unlike `file.read` (which intentionally returns empty content for binary files — that command exists for the text editor preview and must keep that behavior), this command always base64-encodes whatever bytes are on disk. A hard safety ceiling (25MB) prevents accidentally slurping a huge file into memory/IPC; above it, `content` is `""` and `size` is still populated so the caller can show a size-based error. `unreadable: true` on stat/read failure (missing file, permissions). No BOM/text-encoding detection — this command doesn't care whether the file is text.

Used only by the drop-to-attach path in `TaskComposer`. The existing 2MB business limit stays enforced client-side, exactly as it is today for the file-picker path.

**`kanban.materializeAttachments`** (sidecar `AttachmentMaterializer.materialize`, Rust `kanban_materialize_attachments`, TS `kanbanMaterializeAttachments`)

```
{ worktreePath: string, taskId: string, attachments: Attachment[] } → { paths: string[] }
```

For each attachment, decodes `content` per its `encoding` field (`"utf8"` → `Buffer.from(content, "utf8")`, `"base64"` → `Buffer.from(content, "base64")`) and writes it to `<worktreePath>/.maverick/attachments/<taskId>/<sanitized-name>`, creating the directory as needed. Returns the absolute paths written, in the same order as the input attachments. This is a fresh write into a directory that does not yet exist for this task — it deliberately does not reuse `FileWriter.write` (which assumes the parent directory already exists and adds atomic-rename + mtime-conflict semantics irrelevant to a one-shot attachment dump).

### `TaskComposer.tsx`

- Add a `rootRef` on the composer root `<div>`. Replace the `onDragOver`/`onDrop`/`onDragLeave` props with a `useEffect` calling `registerFileDropTarget(rootRef.current, { onPaths: processPaths, onDragState: setIsDraggingOver })`. The existing drop-zone overlay JSX is unchanged — it already keys off `isDraggingOver`.
- New `processPaths(paths: string[])`: for each path, call `fileReadBinary(path)`. If `unreadable`, push the existing-style error (`` `File too large (max 2 MB): ${name}` `` reused for size; a new short message for unreadable). If `size > 2MB`, same "File too large" error as the picker path already produces. Otherwise push `{ name: basename(path), content, encoding: "base64", size }`.
- Fix `processFiles`'s binary branch: replace the spreading `btoa(String.fromCharCode(...new Uint8Array(buffer)))` with a chunked encoder (8KB chunks) that never spreads more arguments than the JS engine can take.
- Backend `<Select>`: for each `<SelectItem>`, resolve `brandFor(b.id)` and render `<brand.Icon size={14} />` before the label, falling back to no icon when `brandFor` returns `undefined` (matches `NewWorkspaceDialog.tsx`'s pattern exactly).
- Fix the branch-fetch effect: today it only runs `if (!defaultProjectId) return`. Change the effect (and/or add a mount-time check) so that when there's no `defaultProjectId` but `selectedProjectId` already has a value (from `activeWorkspace?.projectId`), branches still get fetched for it on mount.

### `KanbanBoard.tsx`

Both `onSend` and `handleStart` follow the same shape: `create()` a workspace, build the launch prompt, `stageLaunch`. After `create()` resolves (worktree path is available synchronously — `workspaceCreate` returns it before the async setup script runs), if the task/payload has attachments:

```ts
let attachmentPaths: string[] = [];
if (attachments.length > 0) {
  try {
    const { paths } = await kanbanMaterializeAttachments(ws.worktreePath, task.id, attachments);
    attachmentPaths = paths;
  } catch (e) {
    console.warn("materializeAttachments failed; launching without attachments", e);
  }
}
const prompt = appendAttachments(
  settings ? buildLaunchPrompt(settings.preferences, taskPrompt) : taskPrompt,
  attachmentPaths
);
stageLaunch(ws.id, backend, prompt);
```

New pure helper in `agent-prompt.ts`:

```ts
export function appendAttachments(prompt: string, paths: string[]): string {
  if (paths.length === 0) return prompt;
  return `${prompt}\n\n[Attached files]\n${paths.map((p) => `- ${p}`).join("\n")}`;
}
```

This is best-effort, matching the existing pattern for the settings fetch in both callbacks: a materialization failure logs and the task still launches, just without attachment paths in the prompt.

## Testing

Per `CLAUDE.md`, every public function needs a test and coverage thresholds are CI-enforced (100/95/100/100).

- `sidecar/file-reader.test.ts`: `readBinary` — happy path (base64 round-trip), oversize (returns empty content + size, not unreadable), unreadable (stat throws), zero-byte file.
- `sidecar/attachment-materializer.test.ts` (new): utf8 attachment write, base64 attachment write, directory creation, name sanitization (path traversal / separators in `name`), multiple attachments preserve order.
- `sidecar/rpc-handlers.test.ts`: new cases for `file.readBinary` and `kanban.materializeAttachments` delegate correctly.
- `src-tauri`: passthrough command tests mirroring the existing `file_read`/`file_write` pattern.
- `src/lib/agent-prompt.test.ts`: `appendAttachments` — empty paths returns prompt unchanged, one path, multiple paths, formatting.
- `src/panels/kanban/TaskComposer.test.tsx`: drag-and-drop via the `file-drop` test harness (mirrors `Composer.test.tsx`'s pattern) attaches a file; oversize dropped file shows the error; unreadable path shows an error; backend `<SelectItem>` renders the brand icon; branches fetch on mount when only `activeWorkspace.projectId` is set (no `defaultProjectId` prop); existing chunked-base64 encoder test for a >100KB file (regression test for the stack-overflow fix).
- `src/panels/kanban/KanbanBoard.test.tsx`: `onSend`/`handleStart` call `kanbanMaterializeAttachments` when attachments exist and append paths to the prompt; skip the call and launch normally when there are no attachments; materialization failure doesn't block launch.

## Risks / edge cases

- Sanitizing attachment `name` before joining into a filesystem path is required — a dropped/pasted name could theoretically contain path separators; the materializer must basename+sanitize before writing.
- `taskId` for a brand-new task (in `onSend`) — `kanbanUpsert` must return the persisted task's id before `create()`/materialize runs; confirm `task.id` is available (it already is, per the existing `kanbanUpsert(...)` call which returns the full row).
- Attachment file collisions across relaunches of the same task: writing into `.maverick/attachments/<taskId>/` and overwriting on each materialize call is acceptable (idempotent — same task, same attachments, same output).
