# Project Settings — Design Spec

**Status:** Approved 2026-05-23 — Malhar Ujawane **Owner:** Frontend + Sidecar **Tracking:** docs/superpowers/plans/2026-05-23-project-settings.md (to be written)

## Goal

Per-project configuration UI ("Project Settings") that mirrors Conductor's surface area with Maverick-native naming, stored alongside the existing per-project `maverick.json`. Setup/Run scripts defined here are surfaced and executed from the bottom Panel.

## Non-Goals (v1)

- Log-scraping for preview URL auto-detection (only explicit `previewUrl` templates).
- Per-project MCP servers / skills sections in the modal (schema reserved; UI deferred).
- Sharing scripts across projects via a separate file (Conductor's `conductor.json` analogue).

## Surface Area Summary

1. New `project: {...}` block in `maverick.json`.
2. New `ProjectSettingsPanel` modal sharing chrome with the global `SettingsPanel` via an extracted `SettingsShell`.
3. Three new sidecar RPCs + three Rust commands.
4. Panel Setup/Run tabs read scripts from the active workspace's project and execute via existing `pty_spawn`.
5. Auto-run setup on workspace create; archive on workspace destroy.
6. Files-to-copy step on workspace create.

---

## 1. `maverick.json` Schema Additions

```jsonc
{
  "version": 1,
  "backends":   { /* unchanged */ },
  "worktrees":  { /* unchanged */ },
  "skills":     [ /* unchanged */ ],
  "presets":    [ /* unchanged */ ],
  "automations":[ /* unchanged */ ],
  "mcps":       [ /* unchanged */ ],

  "project": {
    "name": "string",                   // display name; defaults to dir basename
    "rootPath": "string",               // mirror of project path; set on first save
    "workspaces": {
      "basePath":    "string",          // override of global worktrees.base
      "branchFrom":  "string",          // base branch for new workspaces, e.g. "origin/main"
      "filesToCopy": ["string"]         // relative paths copied into new worktrees
    },
    "remote": "string",                 // push/pull/PR target, default "origin"
    "previewUrl": "string",             // supports ${WORKSPACE_NAME}, ${WORKSPACE_PORT}, ${WORKSPACE_PATH}
    "scripts": {
      "setup":   "string",              // runs once on workspace create
      "run":     "string",              // runs on Panel Run click
      "archive": "string"               // runs before workspace destroy
    },
    "preferences": {
      "review":           "string",
      "createPr":         "string",
      "fixErrors":        "string",
      "resolveConflicts": "string",
      "branchRename":     "string",
      "general":          "string"
      // unknown extra keys allowed via z.record() — additive without migration
    }
  }
}
```

**Rules**

- Entire `project` block is optional; loader normalizes missing fields to defaults so consumers always read a fully-populated `ProjectSettings` struct.
- `workspaces.basePath` overrides the global `worktrees.base` per project (behavior chosen during design).
- Unknown keys under `preferences.*` are preserved on write so additive preference fields don't require a schema migration.

**Defaults applied by loader when absent:**

- `name`: basename of the project directory
- `rootPath`: project root path
- `workspaces.branchFrom`: `origin/main`
- `workspaces.filesToCopy`: `[]`
- `remote`: `origin`
- `previewUrl`: `""`
- All scripts and preferences: `""`

---

## 2. Modal Architecture

### 2.1 Shared Shell

Extract from current `SettingsPanel`:

```plaintext
src/components/settings-shell/
  SettingsShell.tsx          // Dialog + 240px nav rail + content pane + footer grid
  SettingsNavRail.tsx        // generic groups + items, selected/onSelect
  SettingsHeader.tsx         // title + description + optional badge
  SettingsFooter.tsx         // status pill API (idle/dirty/saving/error)
  SettingsJsonEditor.tsx     // generic JSON editor: value + zod schema + onSave
```

`SettingsPanel` (global) and `ProjectSettingsPanel` (per-project) both render `<SettingsShell>` with their own nav groups, sections, store hook, and identity (title chip). Visual chrome stays unified.

### 2.2 `ProjectSettingsPanel` Sections

```plaintext
ABOUT
  · Identity          (name, root path display, "Remove project" action)

WORKSPACES
  · Workspaces        (basePath, branchFrom, filesToCopy editor, remote)
  · Preview           (previewUrl with env-var helper)

EXECUTION
  · Scripts           (setup, run, archive — monospace textareas + "Open in editor" link)

AGENT
  · Preferences       (6 textareas)
```

Title chip in `SettingsHeader`: **"Project Settings · {[project.name](http://project.name)}"**.

JSON mode: shows entire `maverick.json` (not just the `project` block) so users can edit any field. Validation via the same zod schema.

### 2.3 Component Contract

Each section component takes no props and pulls state from `useProjectSettingsStore(projectId)`. Project ID flows down through React context (`<ProjectSettingsProvider projectId={…}>`) so section components stay reusable across projects.

---

## 3. Data Flow & Save

### 3.1 IPC

| RPC | Request | Response |
| --- | --- | --- |
| `project.settings.get` | `{ projectId }` | `ProjectSettings` (fully populated, defaults applied) |
| `project.settings.update` | `{ projectId, patch: Partial<ProjectSettings> }` | `ProjectSettings` (the saved value) |
| `project.settings.openFile` | `{ projectId }` | `{ path }` — also reveals the file in Finder via shell open |

Notification: `project.settings.changed` `{ projectId, settings }` — emitted by sidecar when the file changes on disk (via fs.watch in the sidecar layer).

### 3.2 Rust Commands

`project_settings_get(projectId)` / `project_settings_update(projectId, patch)` / `project_settings_open_file(projectId)` — pass-through wrappers in `src-tauri/src/commands/project_settings.rs`. Registered in `lib.rs::invoke_handler!`. Same pattern as the existing `kanban_*` commands.

### 3.3 React Store

`useProjectSettingsStore(projectId)` — Zustand store keyed by project ID, lazy-loaded on first open:

```ts
{
  status: "idle" | "loading" | "loaded" | "saving" | "error",
  data: ProjectSettings | null,
  dirty: Partial<ProjectSettings>,
  lastError: string | null,
  load:  () => Promise<void>,
  patch: (partial: Partial<ProjectSettings>) => void,
  flush: () => Promise<void>,
}
```

### 3.4 Save Semantics

- **Autosave on blur.** Inputs wire `onBlur` → `store.flush()`. Mid-keystroke edits use `patch()` (local-only).
- **Status pill** in footer:
  - `loaded` (no dirty): `Saved · {relative time}` — muted
  - `dirty` (unflushed): `Unsaved…` — amber
  - `saving`: `Saving…` — muted with spinner
  - `error`: `Failed: {msg}` — destructive, click retries `flush()`
- **Atomic write:** sidecar writes to `maverick.json.tmp` then renames into place. Pre-flight zod parse of merged result before opening the temp file.
- **Empty file vs missing file:** modal opens regardless; first save creates the file with `version: 1`.
- **Conflict handling:** when file changes on disk while modal has dirty edits → banner "File changed on disk — Reload or keep editing (overwrites on next save)". No silent overwrite. If no dirty edits, silently reload.

### 3.5 Error Surfaces

- Schema validation fail → footer message + destructive border on the bad field.
- Disk write fail → footer shows OS error; dirty patch stays in memory for retry.
- File-not-found on `openFile` → toast "Save settings first to create the file".

---

## 4. Panel Integration (Setup / Run)

### 4.1 Context

- Active workspace's project is resolved via existing `selectActiveWorkspace(state)?.projectId`.
- The Panel reads `useProjectSettingsStore(projectId)` — same hook as the modal, so opening the modal is free after the Panel has already loaded the file.

### 4.2 `useScriptRunner` Hook

```ts
useScriptRunner(workspaceId, kind: "setup" | "run") → {
  state: "idle" | "running" | "exited",
  exitCode: number | null,
  startedAt: number | null,
  output: string,      // accumulated PTY data, cap 256 KB, FIFO trim
  start: () => Promise<void>,
  stop:  () => Promise<void>,
}
```

Backed by existing `pty_spawn(workspaceId, "/bin/sh", ["-c", scriptString])` with `cwd = workspace.worktreePath`. Subscribes to `pty:data` / `pty:exit` events filtered to the returned `ptyId`. `stop()` is idempotent.

### 4.3 Tab Rendering Matrix

| script field | tab body |
| --- | --- |
| empty / undefined | Dashed empty-state card: icon + helper text + `Add setup script` / `Add run script` button → `openProjectSettings({ projectId, initialSection: "scripts", focusField: "setup" | "run" })` |
| has content, idle | `Last run · {relative}` line + `View command` expander + `▶ Run setup` / `▶ Run` button |
| running | xterm.js viewport streaming PTY output; red `■ Stop` button; green dot in tab label |
| exited non-zero | xterm output stays visible; red banner "Exited {code}" + `Retry` button |

The Panel header `+` button (already removed) does not return. The existing Run button next to tab labels is the canonical trigger.

### 4.4 Lifecycle Hooks

| event | behavior |
| --- | --- |
| `workspace.create` succeeds | Sidecar auto-runs `scripts.setup` once in the new worktree (if non-empty). Output streams to Setup tab. Non-zero exit doesn't roll back workspace creation. |
| `workspace.destroy` requested | Sidecar runs `scripts.archive` synchronously before deleting the worktree. 30s soft timeout → modal prompts "Force archive?". |
| `scripts.setup` edited later | No auto-rerun. User triggers via Panel Run button. |

### 4.5 Files-to-Copy

When sidecar processes `workspace.create`: after `git worktree add` and before `scripts.setup` runs, copy each path in `workspaces.filesToCopy` from project root → new worktree root. Skip-if-source-missing, preserve mode, no recursion (paths must point at files, not directories — schema validation catches directories at save time).

### 4.6 Preview URL

When `previewUrl` is non-empty, a small `Open preview ↗` button appears at the right end of the `PanelTabs` row (next to the existing `▶ Run` button). Click interpolates `${WORKSPACE_NAME}` / `${WORKSPACE_PORT}` / `${WORKSPACE_PATH}` against the active workspace and opens via Tauri shell `open`. Hidden when `previewUrl` is empty or there is no active workspace.

### 4.7 No Active Workspace

Both tabs show: "Open a workspace from a project to configure setup and run scripts." with secondary link "Configure for a specific project" → opens a lightweight project picker (shadcn `Popover` containing a vertically-scrolling list of `useWorkbench.projects` items keyed by `project.id`, each row showing the project's icon + name + truncated path; click → `openProjectSettings({ projectId, … })`). Single-project case skips the picker and opens directly.

---

## 5. Entry Points

| Entry | Trigger |
| --- | --- |
| Hover-revealed `Cog` icon in `ProjectItem` row | Opens modal for that project |
| Setup / Run empty-state CTA | Opens modal at Scripts section with focused field |
| Command Palette: `Projects: Open project settings…` | Project picker (if multiple) or direct open |
| Command Palette: `Project Settings: Edit maverick.json` | Opens modal in JSON mode |
| Keyboard shortcut `⌘⇧,` | Opens for active workspace's project |

Open/close state lives in `useWorkbench`:

```ts
projectSettings: {
  open: boolean;
  projectId: string | null;
  initialSection?: SectionId;
  focusField?: string;
}
```

`openProjectSettings(args)` helper in the store mutates this and selects the right section.

---

## 6. Build Sequence (Parallel by File-Ownership Zone)

Zones from `CLAUDE.md`:

| Zone | Scope |
| --- | --- |
| **Design system** | Extract `SettingsShell` + generic `SettingsNavRail` / `SettingsJsonEditor` to `src/components/settings-shell/`. Rewire `SettingsPanel` to use it (zero behavior change). Add `Cog` hover affordance to `ProjectItem`. |
| **Sidecar** | Extend `MaverickConfigSchema`; new `config-writer.ts` (atomic write); 3 RPC handlers; `project.settings.changed` fs.watch; workspace-create auto-setup + files-to-copy; workspace-destroy archive hook. Tests for each. |
| **Rust IPC** | 3 new Tauri commands wrapping the sidecar RPCs; registration in `lib.rs`; cargo tests. |
| **Frontend modal** | `src/panels/project-settings/` — `ProjectSettingsPanel.tsx` + 4 section components + `useProjectSettingsStore.ts` + `src/lib/tauri.ts` wrappers + tests. Plus `useWorkbench` state + `CommandPalette` entries + `registry.ts` shortcut. |
| **Panel integration** | `src/hooks/useScriptRunner.ts`; rewrite `Panel.tsx` Setup/Run tabs; empty-state CTAs; preview URL button. Tests. |

**Merge order:**

1. Design system (everything else imports from it).
2. Sidecar + Rust IPC in parallel.
3. Frontend modal + Panel integration in parallel.

**Coverage gates:** every new file gets a sibling `*.test.{ts,tsx}`. CI enforces 100% lines / 95% branches per the repo rule.

---

## 7. Testing Plan

**Sidecar**

- Schema round-trip (write → read → equal) under all defaults.
- Atomic write: mock fs, verify temp-file + rename order.
- `project.settings.changed` fires on fs event.
- Auto-run setup happens on workspace.create with non-empty setup; doesn't run with empty.
- Archive runs synchronously on workspace.destroy and respects the 30s timeout.
- Files-to-copy copies present sources, skips missing.

**Rust**

- Each new command pipes JSON to sidecar and returns the response (mock sidecar via fixture stream).

**React store**

- load → patch → flush state transitions.
- Concurrent flush calls coalesce.
- Conflict notification with no dirty edits → silent reload.
- Conflict notification with dirty edits → banner state.
- Retry path after error.

**React components**

- Each section component: field bindings, blur triggers flush, validation errors render.
- `ProjectSettingsPanel`: section switching, JSON-mode toggle, header reflects project name.
- `ProjectItem`: cog appears on hover, click opens modal.
- `Panel`: empty state → CTA opens modal; configured + idle → Run button starts script; running → Stop kills PTY; exited non-zero → red banner + Retry.

**E2E (Playwright, golden path)**

- Add a project → open Project Settings → set setup script → save → create workspace → setup script auto-runs → output appears in Panel.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| User defines destructive `scripts.setup` and it auto-fires on workspace create | Defer to user judgment in v1; surface a follow-up issue to add a "first-time confirm" UX. |
| Conflict resolution UX confuses users editing the file externally | Banner is explicit ("Reload" / "Keep editing — overwrites on next save"). |
| Archive script hangs forever | 30s soft timeout + "Force archive?" modal. |
| Files-to-copy expanded paths leak outside project root | Sidecar validates each path resolves under project root before copy; reject otherwise. |
| Atomic write fails between temp-write and rename | Temp file left behind on next boot is cleaned up by loader (best-effort `unlink` on stale `*.tmp`). |
| Mixing modal's "JSON mode" + autosave-on-blur in form mode could cause races | JSON mode disables form autosave while active; only the editor's explicit Save writes. |

---

## 9. Out of Scope (Tracked for Follow-up)

- Per-project MCP server overrides UI.
- Per-project skill overrides UI.
- Preview URL log-scraping ("auto-detect from output logs").
- Spotlight testing toggle (Conductor's feature).
- Sharing scripts via shared `*.json` reference.
- Workspace settings (per-workspace overrides of project settings).

---

*Last updated: 2026-05-23 — Malhar Ujawane*