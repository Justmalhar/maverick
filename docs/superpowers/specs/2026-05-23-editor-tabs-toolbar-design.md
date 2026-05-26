# Editor Tabs Toolbar — Design Spec

**Status:** Approved 2026-05-23 — Malhar Ujawane
**Owner:** Frontend (Editor/Terminal agent zone)
**Tracking:** docs/superpowers/plans/2026-05-23-editor-tabs-toolbar.md (to be written)

## Goal

Two UX changes to the `EditorTabs` toolbar:

1. **Browser becomes a top-level icon button** next to `+`, not a dropdown item.
2. **`+` dropdown gains a "New Terminal" entry** that opens a standalone terminal tab (a new third tab kind, distinct from workspaces and system tabs). cwd defaults to the active workspace's worktree, then the first project's path, then `~/Desktop`.

## Non-Goals (v1)

- Splits inside a terminal tab (single pane only — `SplitGrid` is workspace-only for now).
- Persisting terminal tabs across app restarts.
- Renaming terminal tabs from the UI.
- A keybinding for "new terminal" (placeholder shortcut shown in menu, but no actual handler wired).
- Drag-reordering terminal tabs relative to workspace tabs.

## Surface Area Summary

1. New `TerminalTab` concept in `src/state/store.ts` with three exclusivity rules.
2. `EditorTabs.tsx` renders a Browser button before `+`, removes Browser from the dropdown, adds a "New" group with a Terminal item.
3. `EditorGroup.tsx` renders a `TerminalPane` for the active terminal tab, keep-alive style.
4. `ptySpawn` (TS wrapper + Rust shim) gains a `cwd?: string` parameter — the sidecar Zod schema already accepts it.
5. Helper `defaultTerminalCwd()` resolves the cwd via active workspace → first project → `desktopDir()`.

---

## 1. Store Changes (`src/state/store.ts`)

### New type

```ts
export interface TerminalTab {
  id: string;        // "term-<uuid>"
  cwd: string;       // absolute path
  title: string;     // basename(cwd) — e.g. "Desktop", "maverick"
  ptyId: string;     // returned from pty.spawn; lifecycle owned by the tab
}
```

### Added to `WorkbenchState`

```ts
terminalTabs: TerminalTab[];
activeTerminalTabId: string | null;

addTerminalTab: (tab: TerminalTab) => void;       // pure-state insert
removeTerminalTab: (id: string) => void;          // pure-state remove
setActiveTerminalTab: (id: string | null) => void;
```

Following the existing pattern (e.g. `addWorkspace`), the store stays synchronous and pure — async work (`ptySpawn`, `ptyKill`) is orchestrated by a new hook, not by the store.

### Mutual exclusivity

Setting any one of `activeWorkspaceId` / `activeSystemTab` / `activeTerminalTabId` nulls the other two. Existing `setActiveWorkspace` and `setActiveSystemTab` are updated to also null `activeTerminalTabId`. `openSystemTab` and `addWorkspace` (where they already null the other active) extend the same way.

## 2. New Hook (`src/hooks/useTerminalTab.ts`)

```ts
export function useTerminalTab() {
  const addTerminalTab = useWorkbench((s) => s.addTerminalTab);
  const removeTerminalTab = useWorkbench((s) => s.removeTerminalTab);
  const setActiveTerminalTab = useWorkbench((s) => s.setActiveTerminalTab);

  const open = useCallback(async (cwd: string) => {
    const id = `term-${crypto.randomUUID()}`;
    const shell = await invoke<string>("default_shell"); // see §5
    // The same id is used as both workspaceId (PTY label) and TerminalTab.id.
    const { ptyId } = await ptySpawn(id, shell, ["-l"], cwd);
    const tab: TerminalTab = { id, cwd, title: basename(cwd) || cwd, ptyId };
    addTerminalTab(tab);
    setActiveTerminalTab(tab.id);
    return tab;
  }, [addTerminalTab, setActiveTerminalTab]);

  const close = useCallback(async (id: string) => {
    const tab = useWorkbench.getState().terminalTabs.find((t) => t.id === id);
    if (tab) await ptyKill(tab.ptyId).catch(() => {});
    removeTerminalTab(id);
  }, [removeTerminalTab]);

  return { open, close };
}
```

A single uuid is used for both the React-side `TerminalTab.id` and the PTY's `workspaceId` label — the latter is only stored for tagging in `ProcessManager`, never dereferenced.

## 3. cwd Resolution Helper

A new utility `src/lib/default-cwd.ts`:

```ts
export async function defaultTerminalCwd(): Promise<string> {
  const s = useWorkbench.getState();
  const activeWs = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
  if (activeWs?.worktreePath) return activeWs.worktreePath;
  const firstProject = s.projects[0];
  if (firstProject?.path) return firstProject.path;
  const { desktopDir } = await import("@tauri-apps/api/path");
  return await desktopDir();
}
```

`@tauri-apps/api/path` is already a transitive dep via Tauri v2; no new package.

## 4. IPC Changes

### `src/lib/tauri.ts`

```ts
export async function ptySpawn(
  workspaceId: string,
  command: string,
  args: string[],
  cwd?: string,
): Promise<{ ptyId: string }> {
  return invoke("pty_spawn", { workspaceId, command, args, cwd });
}
```

### `src-tauri/src/commands/pty.rs`

```rust
#[tauri::command]
pub async fn pty_spawn(
    state: State<'_, AppState>,
    workspace_id: String,
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<Value, String> {
    state.sidecar.request("pty.spawn", json!({
        "workspaceId": workspace_id,
        "command": command,
        "args": args,
        "cwd": cwd,
    })).await.map_err(|e| e.to_string())
}
```

### Sidecar schema

`sidecar/rpc-handlers.ts` already declares `cwd: z.string().optional()` on `ptySpawn`. No change.

## 5. `default_shell` Tauri command

New tiny command (Rust side) that reads `$SHELL` env var, falling back to `/bin/zsh` on macOS and `/bin/bash` elsewhere. Lives in `src-tauri/src/commands/shell.rs`. Registered in `src-tauri/src/lib.rs` alongside `pty_spawn`.

```rust
#[tauri::command]
pub fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(target_os = "macos") { "/bin/zsh".into() } else { "/bin/bash".into() }
    })
}
```

## 6. UI Changes (`src/components/editor/EditorTabs.tsx`)

### Right cluster (top-down, left-to-right)

| Order | Button | Action |
|---|---|---|
| 1 | `Globe` (Browser) | `openSystemTab("browser")` |
| 2 | `Plus` (dropdown trigger) | menu (see below) |
| 3 | `SplitSquareHorizontal` | existing split editor (no change) |

The Browser button reuses the same styling as `+`: `flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-hover hover:text-foreground`. Tooltip: "Open browser" with `⌘⇧B` shortcut shown.

### Dropdown content

```
[NEW]
  TerminalSquare  Terminal              ⌃`

[OPEN AS TAB]
  LayoutDashboard Dashboard
  CheckSquare2    Tasks                 ⌘⇧K
  Zap             Automations           ⌘⇧A
  Plug            MCP Servers
────────────────────────────────────────────
                  All commands…          ⌘⇧P
```

- "New" section first (above the existing "Open as tab" label).
- "Terminal" item resolves cwd via `defaultTerminalCwd()`, then calls `useTerminalTab().open(cwd)`.
- The Browser row is removed from the iteration. Implementation: filter `SystemTabId` array `["dashboard", "kanban", "automations", "mcps"]` (drop `browser`) before mapping.

### Tab rendering

In the tabs strip:

1. System tabs (unchanged order).
2. Workspace tabs (unchanged order).
3. Terminal tabs (new — appended at the end).

Each terminal tab renders identically to a system tab style (icon + label + close X) but uses the `TerminalSquare` lucide icon and the tab's `title`. `data-testid="editor-tab-terminal-${id}"`.

## 7. `EditorGroup.tsx`

Add a third active branch parallel to system tabs:

```tsx
const terminalTabs = useWorkbench((s) => s.terminalTabs);
const activeTerminalTabId = useWorkbench((s) => s.activeTerminalTabId);
const showTerminalTab = activeTerminalTabId && terminalTabs.some((t) => t.id === activeTerminalTabId);
```

When `showTerminalTab`, render a `<TerminalPane>` directly (no `SplitGrid`). Since v1 has a single pane per terminal tab, `isFocused` is always true and `onFocus` is a noop:

```tsx
{terminalTabs.map((tab) => (
  <div
    key={tab.id}
    data-testid={`terminal-tab-content-${tab.id}`}
    className={cn(
      "absolute inset-0",
      !showTerminalTab || tab.id !== activeTerminalTabId ? "keep-alive-hidden content-visibility-auto" : null
    )}
    aria-hidden={tab.id !== activeTerminalTabId}
  >
    <TerminalPane ptyId={tab.ptyId} paneId={tab.id} isFocused onFocus={() => {}} />
  </div>
))}
```

Keep-alive identical to workspace tabs — PTY survives tab switches.

`hasAnyTabs` check expands to `workspaces.length > 0 || systemTabs.length > 0 || terminalTabs.length > 0`.

## 8. Tests

### `src/components/editor/EditorTabs.test.tsx`

- Browser button is rendered in the right cluster.
- Clicking Browser button calls `openSystemTab("browser")`.
- Dropdown does **not** contain `editor-tabs-open-browser`.
- Dropdown contains `editor-tabs-open-terminal`.
- Clicking "New Terminal" calls `ptySpawn` (mocked) and adds a `TerminalTab` to state.

### `src/state/store.test.ts`

- `setActiveTerminalTab(id)` nulls `activeWorkspaceId` and `activeSystemTab` (the store action does the exclusivity, not `addTerminalTab` — which is pure-state).
- `setActiveWorkspace` nulls `activeTerminalTabId`.
- `openSystemTab` nulls `activeTerminalTabId`.
- `removeTerminalTab` clears active when removing the active tab.

### `src/components/editor/EditorGroup.test.tsx`

- Active terminal tab renders a `TerminalPane`.
- Inactive terminal tab is hidden (`aria-hidden="true"`) but mounted.

### `src/lib/tauri.test.ts`

- `ptySpawn` forwards a `cwd` argument when provided.

### `src/hooks/useTerminalTab.test.ts` (new)

- `open(cwd)` spawns a PTY, adds the tab, sets it active.
- `close(id)` calls `ptyKill` and removes the tab.

### `src/lib/default-cwd.test.ts` (new)

- Returns active workspace's worktreePath when one is active.
- Falls back to first project path when no workspace is active.
- Falls back to `desktopDir()` mock when no projects.

## 9. File Ownership

All touched files fall under the Editor/Terminal agent zone (`src/components/editor/**`) and the Rust IPC agent zone (`src-tauri/**`). No coordinator comment needed.

## 10. Rollout

Single PR. No feature flag. The new "New Terminal" entry is discoverable but additive — existing flows are untouched.
