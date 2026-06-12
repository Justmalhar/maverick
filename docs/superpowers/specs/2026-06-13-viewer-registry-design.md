# Viewer Registry, Editor Tabs & Diff Viewer — Design Spec

**Date:** 2026-06-13
**Status:** Approved for planning
**Branch:** `main` (no feature branch — per owner instruction)

## Problem

Clicking a file in the file tree opens a read-only preview in the AuxiliaryBar instead
of a real editor tab. Clicking a changed file in Source Control / Changes shows only
stats — no diff. Maverick has no code editor, no file write capability, and the
existing preview components (`FilePreviewPanel` + markdown/pdf/image/video/raw) are
trapped in a sidebar-only render path.

## Goals

1. Clicking a file opens it as a **tab in the EditorArea** with a full IDE-style editor
   (VSCode preview-tab semantics: single-click = reusable italic preview tab,
   double-click / edit = pinned).
2. Clicking a changed file opens a **diff viewer tab** with a Conductor-style toolbar:
   file path breadcrumb, undo changes, Diff⟷Edit switcher, inline/side-by-side toggle,
   copy contents, Open With…, viewed checkbox.
3. An **object-oriented viewer registry**: a library of viewers keyed by file type and
   intent. Adding a viewer requires zero changes outside the viewers zone.
4. Ship viewers: code (Monaco), diff (Monaco DiffEditor), markdown (view⟷edit),
   image, video, PDF, CSV/TSV/XLSX grid, hex/raw fallback.
5. **Tier-1 VSCode extension compatibility**: TextMate grammars + VSCode themes via
   Shiki, so highlighting matches VSCode for 200+ languages.

## Non-Goals (this milestone)

- LSP integration (Tier 2) and the embedded extension host + Open VSX install flow
  (Tier 3). Both are documented as roadmap below and the architecture must not block
  them.
- Multi-file search/replace, minimap settings UI, editor preferences panel.
- Collaborative/remote editing.

## Decisions Made

| Decision | Choice | Rationale |
|---|---|---|
| Editor engine | **Monaco** | Built-in DiffEditor (side-by-side + inline), TextMate-compatible, the only frontend a future Tier-3 extension host can target. Bundle cost (~3.5 MB gz) justified: one dep is the editor, the diff engine, and the extension-host target. Lazy-loaded as its own chunk. |
| Extension scope | **Tier 1 only** | Grammars + themes now; LSP and extension host later. |
| Tab UX | **VSCode preview-tab semantics** | Single-click reuses one italic preview tab; double-click/edit pins. AuxiliaryBar preview panel is **removed**. |
| Viewer set | All: markdown (view+edit), image+video, PDF, CSV/XLSX grid | Promote existing preview components into the registry; grid is new. |
| Branch | `main` directly | Owner instruction. |

## Architecture

### Viewer registry (`src/lib/viewers/`, components in `src/components/viewers/`)

Mirrors the `TerminalRegistry` rule: **nothing outside the viewers zone imports
Monaco, pdfjs, SheetJS, or any viewer implementation.** All dispatch goes through the
registry.

```ts
// src/lib/viewers/types.ts
type ViewerIntent = "preview" | "edit" | "diff";

interface FileMeta {
  path: string;          // absolute
  name: string;          // basename
  ext: string;           // lowercase, no dot
  binary: boolean;       // from FileReadResult
  size: number;
}

interface ViewerDescriptor {
  id: string;            // "code" | "diff" | "markdown" | "image" | "video" | "pdf" | "grid" | "hex"
  displayName: string;   // for "Open With…" menu
  priority: number;      // higher wins among canHandle matches
  canHandle(file: FileMeta, intent: ViewerIntent): boolean;
  capabilities: { edit?: boolean; diff?: boolean };
  load(): Promise<ComponentType<ViewerProps>>;   // every viewer lazy-loads
}

interface ViewerActions {
  save?(): Promise<void>;
  copyContents?(): Promise<void>;
  discardChanges?(): Promise<void>;
  setMode?(mode: FileTab["mode"]): void;
}

interface ViewerProps {
  tab: FileTab;
  onDirtyChange(dirty: boolean): void;
  registerActions(actions: ViewerActions): void;  // toolbar binds to these
}
```

`ViewerRegistry.resolve(file, intent): ViewerDescriptor[]` returns priority-ordered
candidates. First is the default; the full list populates "Open With…".
`viewerId` on the tab overrides resolution.

### FileTab model (`src/state/store.ts`)

A fourth tab family alongside workspaces, terminal tabs, and system tabs:

```ts
interface FileTab {
  id: string;
  kind: "file" | "diff";
  path: string;            // absolute
  worktreePath: string;    // project/worktree root (diff context, breadcrumb base)
  viewerId?: string;       // "Open With…" override
  preview: boolean;        // italic preview tab, reused by next single-click
  dirty: boolean;
  mode: "view" | "edit" | "diff";
}
```

Store mutations: `openFileTab(input)` (implements preview replacement: if an unpinned
preview tab exists, it is replaced in place), `pinFileTab(id)`, `closeFileTab(id)`
(blocks on dirty → confirm dialog), `setFileTabDirty(id, dirty)`,
`setFileTabMode(id, mode)`, `setFileTabViewer(id, viewerId)`.

Pinning triggers: double-click in FilesView, any edit (dirty=true), double-click on
the tab itself, explicit keep action.

Keep-alive: the active file tab plus the same LRU strategy used for workspaces —
inactive file-tab panes go `display:none`, Monaco models are retained per path until
tab close.

### Removal of the sidebar preview path

Deleted: `previewFile` state, `openPreview()`, `closePreview()`,
`togglePreviewRaw()`, `PreviewView.tsx`, the `"preview"` member of `AuxiliaryView`.
`FilePreviewPanel`'s child components (Markdown/PDF/Image/Video/Raw previews) are
**promoted** into registry viewers, not rewritten. Existing tests for the preview
path are migrated to the new viewers.

### Monaco + Tier-1 TextMate stack (`src/lib/viewers/monaco/`)

- `monaco-editor` as a lazy Vite chunk; web workers configured for the Tauri webview
  (editor worker + no language workers beyond JSON/CSS/TS defaults we choose to keep —
  highlighting comes from Shiki, not Monarch).
- `shiki` + `@shikijs/monaco`: VSCode's actual TextMate grammars and themes injected
  into Monaco. Grammars lazy-load per language on first open.
- `maverick-dark` theme JSON generated from `src/styles/tokens.css` values (true-black
  background, purple accent), registered with Shiki; theme switching follows the
  existing `data-theme` mechanism.
- Exposed via `getMonaco(): Promise<MonacoApi>` singleton — the only entry point,
  à la `TerminalRegistry.get()`.

### ViewerToolbar (`src/components/viewers/ViewerToolbar.tsx`)

Rendered by the file-tab pane above viewer content (Conductor-style):

- Breadcrumb file path relative to `worktreePath` (segment click → reveal in FilesView).
- Dirty indicator + Save.
- **Diff ⟷ Edit switcher** (visible when the resolved viewer has `capabilities.diff`
  or tab kind is `diff`).
- Inline / side-by-side toggle (diff mode only).
- **Undo changes** → `git_discard_file` behind a confirm dialog.
- **Copy contents** (current file text to clipboard).
- "Open With…" dropdown (registry candidates).
- Viewed checkbox (diff tabs; state kept per session in the store).

The toolbar is generic: it renders only the actions the active viewer registered via
`registerActions`, plus mode switching from the descriptor's capabilities.

### Diff viewer

Monaco `DiffEditor`:

- **Original side:** file content at `HEAD` via new IPC `file_read_at_ref`.
- **Modified side:** working-tree file, **editable live** — the Diff/Edit switcher
  swaps which Monaco surface (diff editor vs plain editor) renders the *same* text
  model, so edits persist across mode switches.
- Saving from either mode writes through `file_write`.
- Existing `diffGet()` hunks continue to power the SCM file list and stats.
- Added/deleted files: original side empty / modified side empty respectively.

### New IPC commands

Sidecar owns the logic; Rust stays a JSON-RPC passthrough. Types are added to both
`src/lib/ipc.ts` and `sidecar/types.ts`.

| Command | Signature | Notes |
|---|---|---|
| `file_write` | `(path, content, expectedMtime?) → { mtime }` | Atomic write (temp + rename). If `expectedMtime` mismatches the on-disk mtime, returns a conflict error; UI shows a conflict bar (reload / overwrite). |
| `file_read_at_ref` | `(worktreePath, path, ref) → { content, binary }` | `git show REF:path`; powers the diff original side. |
| `git_discard_file` | `(worktreePath, path) → void` | `git checkout -- path` (or `git clean` for untracked); powers Undo changes. |

External edits: the existing `onFsChanged` watcher reloads clean tabs in place; dirty
tabs show the conflict bar instead of silently clobbering.

### Viewer library (v1)

| Viewer | id | Handles | Implementation |
|---|---|---|---|
| Code | `code` | any text file, intents preview/edit | Monaco editor, ⌘S save, Shiki highlighting |
| Diff | `diff` | any text file, intent diff | Monaco DiffEditor as above |
| Markdown | `markdown` | `md`, `mdx`, `markdown` | Rendered (existing react-markdown) ⟷ Monaco source toggle |
| Image | `image` | png/jpg/jpeg/gif/webp/svg/bmp/ico | Promoted ImagePreview + zoom/fit controls |
| Video | `video` | mp4/webm/mov | Promoted VideoPreview |
| PDF | `pdf` | pdf | Promoted pdfjs preview + paging/zoom |
| Grid | `grid` | csv/tsv (papaparse), xlsx (lazy SheetJS ~250 KB gz) | react-window virtualised grid, sort, column resize |
| Hex/Raw | `hex` | binary fallback, lowest priority catch-all | Promoted RawPreview |

### Entry points

- **FilesView**: single-click → `openFileTab({ preview: true })`; double-click →
  pinned. (Replaces `openPreview`.)
- **SourceControlView / DiffView (Changes)**: click changed file →
  `openFileTab({ kind: "diff" })`.
- **QuickOpen (⌘P)**: selecting a file opens a pinned file tab.

## Performance & bundle budget

- Monaco, Shiki grammars, SheetJS, pdfjs all lazy chunks; nothing loads until the
  first tab of that type opens. Justifications recorded in the PR per rule 8.
- Keep-alive identical to workspace strategy (`display:none`,
  `content-visibility: auto`).
- Grid and any list > 50 rows virtualised with react-window.
- Workspace-switch <10 ms budget unaffected: file tabs participate in the same LRU.

## Testing

- **Registry**: unit tests for resolution order, intent filtering, override,
  fallback-to-hex.
- **Store**: preview-tab replacement, pinning triggers, dirty-close blocking.
- **Viewers**: component tests per viewer; Monaco mocked in `src/test/setup.ts`
  (model + editor fakes), Shiki mocked; existing diff2html/pdfjs/react-markdown mocks
  reused or replaced.
- **Sidecar**: bun tests for `file_write` (atomic, conflict), `file_read_at_ref`,
  `git_discard_file` against a fixture repo.
- **Toolbar**: action wiring, mode switching, confirm dialog on discard.
- Coverage thresholds unchanged (lines 100 / branches 95).

## Subagent workstreams (zone-aligned)

| WS | Zone / Agent | Scope | Depends on |
|---|---|---|---|
| A | `sidecar/**` + `src-tauri/**` | 3 IPC commands, Rust passthrough, types both sides, bun tests | — |
| B | Frontend shell (`src/state/**`, `src/components/editor/**` tabs) | FileTab slice, preview semantics, EditorTabs/EditorGroup render case, delete sidebar preview path | — |
| C | Editor agent (`src/lib/viewers/monaco/**`) | Monaco bootstrap, Vite workers, Shiki bridge, token-derived theme, `getMonaco()` | — |
| D | Viewer agent (`src/lib/viewers/**`, `src/components/viewers/**`) | Registry, contract, ViewerToolbar shell, promote markdown/image/video/pdf/hex | B |
| E | Editor agent | CodeViewer (save/conflict flow), DiffViewer (full toolbar), SCM/Changes/QuickOpen integration | A, B, C, D |
| F | Viewer agent | Grid viewer (csv/tsv/xlsx) | D |
| G | Test agent (any zone) | Coverage enforcement, Monaco/Shiki mocks, integration pass (`bun run tauri dev` golden path) | all |

A/B/C run in parallel; D follows B; E and F fan out after.

## Extension roadmap (recorded, out of scope)

- **Tier 2 — LSP**: sidecar spawns language servers (it already owns process
  spawning) and bridges them to Monaco via `monaco-languageclient`-style glue.
  Diagnostics, hover, completion without any VSCode API.
- **Tier 3 — extension host + Open VSX**: run VSCode's open-source extension host as
  a sidecar-managed Node process; install VSIX packages from **Open VSX**
  (Microsoft's marketplace ToS forbids non-VSCode clients; Open VSX is the legal
  registry). Extension-contributed custom editors become registry descriptors —
  the `ViewerDescriptor` contract is the seam.
