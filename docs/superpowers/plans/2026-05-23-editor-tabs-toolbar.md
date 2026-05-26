# Editor Tabs Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Browser tab opener to a standalone icon button in `EditorTabs`, and add a "New Terminal" entry to the `+` dropdown that opens a standalone terminal tab (a new third tab kind) at the active workspace's cwd, or `~/Desktop` if none.

**Architecture:**
- New `TerminalTab` concept in the workbench store, mutually exclusive with `activeWorkspaceId` and `activeSystemTab`.
- New `useTerminalTab` hook orchestrates PTY spawn/kill around the pure-state store actions.
- `EditorTabs` toolbar gains a standalone Globe button; `EditorGroup` renders a keep-alive `<TerminalPane>` per terminal tab.
- `ptySpawn` gains a `cwd?: string` parameter (TS wrapper + Rust shim — sidecar Zod already accepts it). New `default_shell` Rust command resolves `$SHELL`.

**Tech Stack:** React + Zustand + Tauri v2 + lucide-react + shadcn. Vitest + @testing-library/react. Rust `tauri::command`.

**Spec:** `docs/superpowers/specs/2026-05-23-editor-tabs-toolbar-design.md`

---

## File Structure

**Create:**
- `src/hooks/useTerminalTab.ts` — async open/close orchestrator
- `src/hooks/useTerminalTab.test.ts`
- `src/lib/default-cwd.ts` — cwd resolver (active workspace → first project → `desktopDir()`)
- `src/lib/default-cwd.test.ts`
- `src-tauri/src/commands/shell.rs` — `default_shell` command

**Modify:**
- `src/state/store.ts` — add `TerminalTab`, `terminalTabs`, `activeTerminalTabId`, exclusivity updates
- `src/state/store.test.ts` — exclusivity + lifecycle tests
- `src/lib/tauri.ts` — `ptySpawn(workspaceId, command, args, cwd?)`, new `defaultShell()` wrapper
- `src/lib/tauri.test.ts` — assert `cwd` forwarded, `default_shell` wrapper exercised
- `src/components/editor/EditorTabs.tsx` — Browser standalone button, terminal-tab strip, "New Terminal" dropdown item, Browser removed from dropdown
- `src/components/editor/EditorTabs.test.tsx` — new assertions
- `src/components/editor/EditorGroup.tsx` — render `TerminalPane` for active terminal tab
- `src/components/editor/EditorGroup.test.tsx` — new assertion
- `src-tauri/src/commands/pty.rs` — `cwd: Option<String>` param
- `src-tauri/src/commands/mod.rs` — export `default_shell`
- `src-tauri/src/lib.rs` — register `default_shell` in `invoke_handler!`

---

## Task 1: Store — TerminalTab type + state + pure actions

**Files:**
- Modify: `src/state/store.ts`
- Test: `src/state/store.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/state/store.test.ts` (after the existing `closeProjectSettings` test, inside the same `describe`):

```ts
  it("terminal tabs: add, remove, set active, mutual exclusivity", () => {
    const tab1 = { id: "t1", cwd: "/Users/me/Desktop", title: "Desktop", ptyId: "pty-1" };
    const tab2 = { id: "t2", cwd: "/Users/me/code", title: "code", ptyId: "pty-2" };

    useWorkbench.getState().addTerminalTab(tab1);
    useWorkbench.getState().addTerminalTab(tab2);
    expect(useWorkbench.getState().terminalTabs.map((t) => t.id)).toEqual(["t1", "t2"]);

    // setActiveTerminalTab nulls workspace and system tab actives
    useWorkbench.setState({ activeWorkspaceId: "w1", activeSystemTab: "browser" });
    useWorkbench.getState().setActiveTerminalTab("t2");
    expect(useWorkbench.getState().activeTerminalTabId).toBe("t2");
    expect(useWorkbench.getState().activeWorkspaceId).toBeNull();
    expect(useWorkbench.getState().activeSystemTab).toBeNull();

    // setActiveWorkspace nulls activeTerminalTabId
    useWorkbench.getState().setActiveWorkspace("w1");
    expect(useWorkbench.getState().activeTerminalTabId).toBeNull();

    // openSystemTab nulls activeTerminalTabId
    useWorkbench.getState().setActiveTerminalTab("t1");
    useWorkbench.getState().openSystemTab("browser");
    expect(useWorkbench.getState().activeTerminalTabId).toBeNull();

    // removeTerminalTab clears active when removing the active tab
    useWorkbench.getState().setActiveTerminalTab("t1");
    useWorkbench.getState().removeTerminalTab("t1");
    expect(useWorkbench.getState().activeTerminalTabId).toBeNull();
    expect(useWorkbench.getState().terminalTabs.map((t) => t.id)).toEqual(["t2"]);

    // removeTerminalTab on inactive tab does not clear active
    useWorkbench.getState().setActiveTerminalTab("t2");
    useWorkbench.getState().addTerminalTab({ ...tab1 });
    useWorkbench.getState().removeTerminalTab("t1");
    expect(useWorkbench.getState().activeTerminalTabId).toBe("t2");
  });
```

Also extend the `beforeEach` reset block in this file to include the new state. Replace the existing `beforeEach` body with:

```ts
beforeEach(() => {
  useWorkbench.setState({
    ...initial,
    projects: [],
    workspaces: [],
    backends: [],
    skills: [],
    activeWorkspaceId: null,
    editorModes: {},
    splitTrees: {},
    terminalTabs: [],
    activeTerminalTabId: null,
    systemTabs: [],
    activeSystemTab: null,
    commandPaletteOpen: false,
    quickOpenOpen: false,
    presetLauncherOpen: false,
    keybindingHelpOpen: false,
    settingsOpen: false,
    layout: {
      activitybarCollapsed: false,
      primarySideBarVisible: true,
      primarySideBarWidth: 240,
      auxiliaryBarVisible: true,
      auxiliaryBarWidth: 280,
      panelVisible: false,
      panelHeight: 220,
      activityView: "projects",
      auxiliaryView: "files",
    },
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run vitest run src/state/store.test.ts`
Expected: FAIL — `addTerminalTab is not a function` (or similar TypeError).

- [ ] **Step 3: Implement in `src/state/store.ts`**

Add the type just above `WorkbenchState`:

```ts
export interface TerminalTab {
  id: string;
  cwd: string;
  title: string;
  ptyId: string;
}
```

Inside `WorkbenchState`, add fields next to the existing system-tabs block:

```ts
  // Terminal tabs (standalone PTY tabs)
  terminalTabs: TerminalTab[];
  activeTerminalTabId: string | null;
```

Add to the mutator type list (next to system tab mutators):

```ts
  // Terminal tabs
  addTerminalTab: (tab: TerminalTab) => void;
  removeTerminalTab: (id: string) => void;
  setActiveTerminalTab: (id: string | null) => void;
```

In the `create<WorkbenchState>()` initial state, add:

```ts
    terminalTabs: [],
    activeTerminalTabId: null,
```

Add the action implementations (place them right after `setActiveSystemTab`):

```ts
    addTerminalTab: (tab) =>
      set((s) => ({
        terminalTabs: s.terminalTabs.some((t) => t.id === tab.id)
          ? s.terminalTabs
          : [...s.terminalTabs, tab],
      })),
    removeTerminalTab: (id) =>
      set((s) => ({
        terminalTabs: s.terminalTabs.filter((t) => t.id !== id),
        activeTerminalTabId: s.activeTerminalTabId === id ? null : s.activeTerminalTabId,
      })),
    setActiveTerminalTab: (id) =>
      set(() => ({
        activeTerminalTabId: id,
        activeWorkspaceId: null,
        activeSystemTab: null,
      })),
```

Update `setActiveWorkspace` to clear terminal tab active:

```ts
    setActiveWorkspace: (id) =>
      set({ activeWorkspaceId: id, activeTerminalTabId: null }),
```

Update `openSystemTab` and `setActiveSystemTab` to clear terminal tab active. Replace those two actions with:

```ts
    openSystemTab: (id) =>
      set((s) => ({
        systemTabs: s.systemTabs.includes(id) ? s.systemTabs : [...s.systemTabs, id],
        activeSystemTab: id,
        activeWorkspaceId: null,
        activeTerminalTabId: null,
      })),
    setActiveSystemTab: (id) =>
      set((s) => ({
        activeSystemTab: id,
        activeWorkspaceId: id ? null : s.activeWorkspaceId,
        activeTerminalTabId: id ? null : s.activeTerminalTabId,
      })),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run vitest run src/state/store.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/state/store.ts src/state/store.test.ts
git commit -m "feat(store): add TerminalTab state with workspace/system-tab exclusivity"
```

---

## Task 2: Tauri wrapper — `ptySpawn` gains `cwd`, add `defaultShell`

**Files:**
- Modify: `src/lib/tauri.ts`
- Test: `src/lib/tauri.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/lib/tauri.test.ts`, replace the existing `it("pty commands", ...)` block with:

```ts
  it("pty commands", async () => {
    await api.ptySpawn("w1", "bash", ["-l"]);
    expect(invoke).toHaveBeenLastCalledWith("pty_spawn", {
      workspaceId: "w1", command: "bash", args: ["-l"], cwd: undefined,
    });
    await api.ptySpawn("w1", "bash", ["-l"], "/Users/me/Desktop");
    expect(invoke).toHaveBeenLastCalledWith("pty_spawn", {
      workspaceId: "w1", command: "bash", args: ["-l"], cwd: "/Users/me/Desktop",
    });
    await api.ptyWrite("pty1", "data");
    expect(invoke).toHaveBeenLastCalledWith("pty_write", { ptyId: "pty1", data: "data" });
    await api.ptyResize("pty1", 80, 24);
    expect(invoke).toHaveBeenLastCalledWith("pty_resize", { ptyId: "pty1", cols: 80, rows: 24 });
    await api.ptyKill("pty1");
    expect(invoke).toHaveBeenLastCalledWith("pty_kill", { ptyId: "pty1" });
  });

  it("defaultShell forwards to the default_shell command", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("/bin/zsh" as never);
    const shell = await api.defaultShell();
    expect(invoke).toHaveBeenLastCalledWith("default_shell");
    expect(shell).toBe("/bin/zsh");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run vitest run src/lib/tauri.test.ts`
Expected: FAIL — the `cwd` assertion fails because the wrapper drops it; `defaultShell` not exported.

- [ ] **Step 3: Implement in `src/lib/tauri.ts`**

Replace the existing `ptySpawn` declaration with:

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

Add (anywhere near the other `pty*` exports):

```ts
export async function defaultShell(): Promise<string> {
  return invoke("default_shell");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run vitest run src/lib/tauri.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tauri.ts src/lib/tauri.test.ts
git commit -m "feat(ipc): add cwd to ptySpawn and defaultShell wrapper"
```

---

## Task 3: Rust — `pty_spawn` forwards `cwd`, add `default_shell`

**Files:**
- Modify: `src-tauri/src/commands/pty.rs`
- Create: `src-tauri/src/commands/shell.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Update `pty_spawn` to accept and forward `cwd`**

Replace the `pty_spawn` function in `src-tauri/src/commands/pty.rs` with:

```rust
#[tauri::command]
pub async fn pty_spawn(
    state: State<'_, AppState>,
    workspace_id: String,
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "pty.spawn",
            json!({
                "workspaceId": workspace_id,
                "command": command,
                "args": args,
                "cwd": cwd,
            }),
        )
        .await
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Create `src-tauri/src/commands/shell.rs`**

```rust
#[tauri::command]
pub fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(target_os = "macos") {
            "/bin/zsh".into()
        } else {
            "/bin/bash".into()
        }
    })
}
```

- [ ] **Step 3: Register the module and export the command**

In `src-tauri/src/commands/mod.rs`, add after the existing `pub mod` lines (keep the alphabetical-ish order — insert after `pub mod pty;`):

```rust
pub mod shell;
```

And in the re-exports block, add after the `pub use pty::...` line:

```rust
pub use shell::default_shell;
```

- [ ] **Step 4: Register in `invoke_handler!`**

In `src-tauri/src/lib.rs`, locate the `tauri::generate_handler![` list and add `default_shell,` adjacent to `pty_kill,` (any position inside the list works; consistency-wise put it after `pty_kill,`).

- [ ] **Step 5: Verify Rust compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean build, no errors. Existing call sites of `pty_spawn` from React do not need changes — the TS wrapper passes `cwd: undefined` when omitted, which Rust deserializes to `Option::None`.

- [ ] **Step 6: Run Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (no Rust tests are added in this task; this confirms no regressions).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/pty.rs src-tauri/src/commands/shell.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(rust): forward cwd to pty_spawn, add default_shell command"
```

---

## Task 4: cwd resolver (`src/lib/default-cwd.ts`)

**Files:**
- Create: `src/lib/default-cwd.ts`
- Test: `src/lib/default-cwd.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/default-cwd.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useWorkbench } from "@/state/store";
import { makeProject, makeWorkspace } from "@/test/fixtures";

vi.mock("@tauri-apps/api/path", () => ({
  desktopDir: vi.fn(async () => "/Users/test/Desktop"),
}));

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({
    ...initial,
    projects: [],
    workspaces: [],
    activeWorkspaceId: null,
  });
});

describe("defaultTerminalCwd", () => {
  it("returns the active workspace's worktreePath when set", async () => {
    useWorkbench.setState({
      workspaces: [makeWorkspace({ id: "w1", worktreePath: "/wt/feature-x" })],
      activeWorkspaceId: "w1",
    });
    const { defaultTerminalCwd } = await import("./default-cwd");
    expect(await defaultTerminalCwd()).toBe("/wt/feature-x");
  });

  it("falls back to first project's path when no active workspace", async () => {
    useWorkbench.setState({
      projects: [makeProject({ id: "p1", path: "/projects/foo" })],
      workspaces: [],
      activeWorkspaceId: null,
    });
    const { defaultTerminalCwd } = await import("./default-cwd");
    expect(await defaultTerminalCwd()).toBe("/projects/foo");
  });

  it("falls back to desktopDir when neither workspace nor project", async () => {
    useWorkbench.setState({ projects: [], workspaces: [], activeWorkspaceId: null });
    const { defaultTerminalCwd } = await import("./default-cwd");
    expect(await defaultTerminalCwd()).toBe("/Users/test/Desktop");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run vitest run src/lib/default-cwd.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/default-cwd.ts`**

```ts
import { useWorkbench } from "@/state/store";

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

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run vitest run src/lib/default-cwd.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/default-cwd.ts src/lib/default-cwd.test.ts
git commit -m "feat(lib): defaultTerminalCwd resolver for standalone terminal tabs"
```

---

## Task 5: `useTerminalTab` hook

**Files:**
- Create: `src/hooks/useTerminalTab.ts`
- Test: `src/hooks/useTerminalTab.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/useTerminalTab.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWorkbench } from "@/state/store";

vi.mock("@/lib/tauri", () => ({
  ptySpawn: vi.fn(async () => ({ ptyId: "pty-xyz" })),
  ptyKill: vi.fn(async () => undefined),
  defaultShell: vi.fn(async () => "/bin/zsh"),
}));

import * as tauri from "@/lib/tauri";
import { useTerminalTab } from "./useTerminalTab";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(tauri.ptySpawn).mockClear();
  vi.mocked(tauri.ptyKill).mockClear();
  vi.mocked(tauri.defaultShell).mockClear();
  useWorkbench.setState({ ...initial, terminalTabs: [], activeTerminalTabId: null });
});

describe("useTerminalTab", () => {
  it("open spawns a PTY at the given cwd, adds a tab, and activates it", async () => {
    const { result } = renderHook(() => useTerminalTab());
    let tabId = "";
    await act(async () => {
      const tab = await result.current.open("/Users/me/Desktop");
      tabId = tab.id;
    });

    expect(tauri.defaultShell).toHaveBeenCalled();
    expect(tauri.ptySpawn).toHaveBeenCalledWith(tabId, "/bin/zsh", ["-l"], "/Users/me/Desktop");

    const state = useWorkbench.getState();
    expect(state.terminalTabs).toHaveLength(1);
    expect(state.terminalTabs[0].cwd).toBe("/Users/me/Desktop");
    expect(state.terminalTabs[0].title).toBe("Desktop");
    expect(state.terminalTabs[0].ptyId).toBe("pty-xyz");
    expect(state.activeTerminalTabId).toBe(tabId);
  });

  it("close kills the PTY and removes the tab", async () => {
    useWorkbench.setState({
      terminalTabs: [{ id: "t1", cwd: "/a", title: "a", ptyId: "pty-1" }],
      activeTerminalTabId: "t1",
    });

    const { result } = renderHook(() => useTerminalTab());
    await act(async () => {
      await result.current.close("t1");
    });

    expect(tauri.ptyKill).toHaveBeenCalledWith("pty-1");
    expect(useWorkbench.getState().terminalTabs).toHaveLength(0);
    expect(useWorkbench.getState().activeTerminalTabId).toBeNull();
  });

  it("close swallows ptyKill rejections", async () => {
    vi.mocked(tauri.ptyKill).mockRejectedValueOnce(new Error("boom"));
    useWorkbench.setState({
      terminalTabs: [{ id: "t1", cwd: "/a", title: "a", ptyId: "pty-1" }],
      activeTerminalTabId: "t1",
    });

    const { result } = renderHook(() => useTerminalTab());
    await act(async () => {
      await result.current.close("t1");
    });

    expect(useWorkbench.getState().terminalTabs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run vitest run src/hooks/useTerminalTab.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/hooks/useTerminalTab.ts`**

```ts
import { useCallback } from "react";
import { useWorkbench, type TerminalTab } from "@/state/store";
import { ptySpawn, ptyKill, defaultShell } from "@/lib/tauri";

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function useTerminalTab() {
  const addTerminalTab = useWorkbench((s) => s.addTerminalTab);
  const removeTerminalTab = useWorkbench((s) => s.removeTerminalTab);
  const setActiveTerminalTab = useWorkbench((s) => s.setActiveTerminalTab);

  const open = useCallback(
    async (cwd: string): Promise<TerminalTab> => {
      const id = `term-${crypto.randomUUID()}`;
      const shell = await defaultShell();
      const { ptyId } = await ptySpawn(id, shell, ["-l"], cwd);
      const tab: TerminalTab = { id, cwd, title: basename(cwd) || cwd, ptyId };
      addTerminalTab(tab);
      setActiveTerminalTab(id);
      return tab;
    },
    [addTerminalTab, setActiveTerminalTab],
  );

  const close = useCallback(
    async (id: string): Promise<void> => {
      const tab = useWorkbench.getState().terminalTabs.find((t) => t.id === id);
      if (tab) {
        try {
          await ptyKill(tab.ptyId);
        } catch {
          // PTY may already be dead — proceed to remove the tab regardless.
        }
      }
      removeTerminalTab(id);
    },
    [removeTerminalTab],
  );

  return { open, close };
}
```

You also need `TerminalTab` to be re-exported from the store. Confirm `src/state/store.ts` already has `export interface TerminalTab` from Task 1 — if not, add the `export` keyword now.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run vitest run src/hooks/useTerminalTab.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useTerminalTab.ts src/hooks/useTerminalTab.test.ts
git commit -m "feat(hooks): useTerminalTab orchestrates standalone terminal tabs"
```

---

## Task 6: EditorTabs — standalone Browser button, terminal-tab strip, dropdown changes

**Files:**
- Modify: `src/components/editor/EditorTabs.tsx`
- Test: `src/components/editor/EditorTabs.test.tsx`

- [ ] **Step 1: Write the failing tests**

Replace the contents of `src/components/editor/EditorTabs.test.tsx` with:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { EditorTabs } from "./EditorTabs";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";

vi.mock("@/lib/tauri", async (orig) => {
  const actual = await orig<typeof import("@/lib/tauri")>();
  return {
    ...actual,
    ptySpawn: vi.fn(async () => ({ ptyId: "pty-1" })),
    ptyKill: vi.fn(async () => undefined),
    defaultShell: vi.fn(async () => "/bin/zsh"),
  };
});

vi.mock("@/lib/default-cwd", () => ({
  defaultTerminalCwd: vi.fn(async () => "/Users/test/Desktop"),
}));

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({
    ...initial,
    workspaces: [],
    activeWorkspaceId: null,
    commandPaletteOpen: false,
    editorModes: {},
    systemTabs: [],
    activeSystemTab: null,
    terminalTabs: [],
    activeTerminalTabId: null,
  });
});

describe("EditorTabs", () => {
  it("renders workspace tabs and reacts to clicks", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" }), makeWorkspace({ id: "w2" })],
      activeWorkspaceId: "w1",
      systemTabs: [],
      activeSystemTab: null,
      terminalTabs: [],
      activeTerminalTabId: null,
    });
    renderWithProviders(<EditorTabs />);
    expect(screen.getByTestId("editor-tab-w1")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("editor-tab-w2"));
    expect(useWorkbench.getState().activeWorkspaceId).toBe("w2");
  });

  it("standalone browser button opens the browser system tab", async () => {
    renderWithProviders(<EditorTabs />);
    await userEvent.click(screen.getByTestId("editor-tabs-browser"));
    expect(useWorkbench.getState().activeSystemTab).toBe("browser");
    expect(useWorkbench.getState().systemTabs).toContain("browser");
  });

  it("plus dropdown contains New Terminal and tab items but not Browser", async () => {
    renderWithProviders(<EditorTabs />);
    await userEvent.click(screen.getByTestId("editor-tabs-new"));
    expect(screen.getByTestId("editor-tabs-open-terminal")).toBeInTheDocument();
    expect(screen.getByTestId("editor-tabs-open-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("editor-tabs-open-kanban")).toBeInTheDocument();
    expect(screen.getByTestId("editor-tabs-open-automations")).toBeInTheDocument();
    expect(screen.getByTestId("editor-tabs-open-mcps")).toBeInTheDocument();
    expect(screen.queryByTestId("editor-tabs-open-browser")).not.toBeInTheDocument();
  });

  it("clicking New Terminal spawns a PTY and adds a terminal tab", async () => {
    renderWithProviders(<EditorTabs />);
    await userEvent.click(screen.getByTestId("editor-tabs-new"));
    await userEvent.click(screen.getByTestId("editor-tabs-open-terminal"));

    // Wait one microtask cycle for the async open() to complete.
    await new Promise((r) => setTimeout(r, 0));

    const state = useWorkbench.getState();
    expect(state.terminalTabs).toHaveLength(1);
    expect(state.terminalTabs[0].cwd).toBe("/Users/test/Desktop");
    expect(state.activeTerminalTabId).toBe(state.terminalTabs[0].id);
  });

  it("renders terminal tabs in the strip and switches on click", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [],
      systemTabs: [],
      activeSystemTab: null,
      terminalTabs: [
        { id: "t1", cwd: "/a", title: "a", ptyId: "pty-1" },
        { id: "t2", cwd: "/b", title: "b", ptyId: "pty-2" },
      ],
      activeTerminalTabId: "t1",
    });
    renderWithProviders(<EditorTabs />);
    expect(screen.getByTestId("editor-tab-terminal-t1")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("editor-tab-terminal-t2"));
    expect(useWorkbench.getState().activeTerminalTabId).toBe("t2");
  });

  it("close button on a terminal tab removes it and kills its PTY", async () => {
    const { ptyKill } = await import("@/lib/tauri");
    useWorkbench.setState({
      ...initial,
      workspaces: [],
      systemTabs: [],
      activeSystemTab: null,
      terminalTabs: [{ id: "t1", cwd: "/a", title: "a", ptyId: "pty-1" }],
      activeTerminalTabId: "t1",
    });
    renderWithProviders(<EditorTabs />);
    const closeBtn = screen.getByLabelText("Close a");
    await userEvent.click(closeBtn);
    await new Promise((r) => setTimeout(r, 0));
    expect(ptyKill).toHaveBeenCalledWith("pty-1");
    expect(useWorkbench.getState().terminalTabs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run vitest run src/components/editor/EditorTabs.test.tsx`
Expected: FAIL — new test ids missing, Browser still in dropdown.

- [ ] **Step 3: Implement `src/components/editor/EditorTabs.tsx`**

Replace the file's contents with:

```tsx
import {
  Plus,
  SplitSquareHorizontal,
  LayoutDashboard,
  Globe,
  CheckSquare2,
  Zap,
  Plug,
  TerminalSquare,
  X,
} from "lucide-react";
import { useWorkbench, type SystemTabId } from "@/state/store";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { EditorTab } from "./EditorTab";
import { useTerminalTab } from "@/hooks/useTerminalTab";
import { defaultTerminalCwd } from "@/lib/default-cwd";

const SYSTEM_TAB_META: Record<
  SystemTabId,
  { label: string; icon: typeof Globe; shortcut?: string }
> = {
  dashboard: { label: "Dashboard", icon: LayoutDashboard },
  browser: { label: "Browser", icon: Globe, shortcut: "⌘⇧B" },
  kanban: { label: "Tasks", icon: CheckSquare2, shortcut: "⌘⇧K" },
  automations: { label: "Automations", icon: Zap, shortcut: "⌘⇧A" },
  mcps: { label: "MCP Servers", icon: Plug },
};

// Browser lives in the toolbar (standalone button), so it is omitted from the dropdown.
const DROPDOWN_TAB_IDS: SystemTabId[] = ["dashboard", "kanban", "automations", "mcps"];

export function EditorTabs() {
  const workspaces = useWorkbench((s) => s.workspaces);
  const activeId = useWorkbench((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useWorkbench((s) => s.setActiveWorkspace);
  const removeWorkspace = useWorkbench((s) => s.removeWorkspace);

  const systemTabs = useWorkbench((s) => s.systemTabs);
  const activeSystemTab = useWorkbench((s) => s.activeSystemTab);
  const openSystemTab = useWorkbench((s) => s.openSystemTab);
  const closeSystemTab = useWorkbench((s) => s.closeSystemTab);
  const setActiveSystemTab = useWorkbench((s) => s.setActiveSystemTab);
  const setCommandPaletteOpen = useWorkbench((s) => s.setCommandPaletteOpen);

  const terminalTabs = useWorkbench((s) => s.terminalTabs);
  const activeTerminalTabId = useWorkbench((s) => s.activeTerminalTabId);
  const setActiveTerminalTab = useWorkbench((s) => s.setActiveTerminalTab);
  const { open: openTerminal, close: closeTerminal } = useTerminalTab();

  async function onNewTerminal() {
    const cwd = await defaultTerminalCwd();
    await openTerminal(cwd);
  }

  return (
    <div
      data-testid="editor-tabs"
      className="mv-editor-tabs flex w-full shrink-0 items-stretch bg-tab-inactive"
      style={{ height: "var(--editor-tabs-height)", borderBottom: "1px solid hsl(var(--border))" }}
    >
      <div className="flex h-full flex-1 items-stretch overflow-x-auto">
        {systemTabs.map((id) => {
          const meta = SYSTEM_TAB_META[id];
          const Icon = meta.icon;
          const active = activeSystemTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSystemTab(id)}
              data-testid={`editor-tab-system-${id}`}
              className={cn(
                "group relative flex min-w-[110px] items-center gap-1.5 px-3 text-[12px] transition-colors duration-100",
                active
                  ? "bg-tab-active text-tab-fg-active"
                  : "bg-tab-inactive text-tab-fg hover:bg-foreground/5 hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
              <span className="flex-1 truncate text-left">{meta.label}</span>
              <span
                role="button"
                tabIndex={0}
                aria-label={`Close ${meta.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeSystemTab(id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    closeSystemTab(id);
                  }
                }}
                className="flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 data-[active=true]:opacity-60"
                data-active={active}
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          );
        })}

        {workspaces.map((ws) => (
          <EditorTab
            key={ws.id}
            workspace={ws}
            active={ws.id === activeId}
            onSelect={() => setActiveWorkspace(ws.id)}
            onClose={() => removeWorkspace(ws.id)}
          />
        ))}

        {terminalTabs.map((tab) => {
          const active = activeTerminalTabId === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTerminalTab(tab.id)}
              data-testid={`editor-tab-terminal-${tab.id}`}
              className={cn(
                "group relative flex min-w-[110px] items-center gap-1.5 px-3 text-[12px] transition-colors duration-100",
                active
                  ? "bg-tab-active text-tab-fg-active"
                  : "bg-tab-inactive text-tab-fg hover:bg-foreground/5 hover:text-foreground"
              )}
            >
              <TerminalSquare className="h-3.5 w-3.5 shrink-0 opacity-70" />
              <span className="flex-1 truncate text-left">{tab.title}</span>
              <span
                role="button"
                tabIndex={0}
                aria-label={`Close ${tab.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void closeTerminal(tab.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    void closeTerminal(tab.id);
                  }
                }}
                className="flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 data-[active=true]:opacity-60"
                data-active={active}
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-px pr-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Open browser"
              data-testid="editor-tabs-browser"
              onClick={() => openSystemTab("browser")}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground"
            >
              <Globe className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Open browser ⌘⇧B</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Open view"
                  data-testid="editor-tabs-new"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">Open view</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>New</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={onNewTerminal}
              data-testid="editor-tabs-open-terminal"
            >
              <TerminalSquare className="h-3.5 w-3.5" />
              <span className="flex-1">Terminal</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Open as tab</DropdownMenuLabel>
            {DROPDOWN_TAB_IDS.map((id) => {
              const meta = SYSTEM_TAB_META[id];
              const Icon = meta.icon;
              return (
                <DropdownMenuItem
                  key={id}
                  onClick={() => openSystemTab(id)}
                  data-testid={`editor-tabs-open-${id}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="flex-1">{meta.label}</span>
                  {meta.shortcut && (
                    <kbd className="text-[10px] text-muted-foreground">{meta.shortcut}</kbd>
                  )}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setCommandPaletteOpen(true)}>
              <span className="flex-1">All commands…</span>
              <kbd className="text-[10px] text-muted-foreground">⌘⇧P</kbd>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Split editor"
              data-testid="editor-tabs-split"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground"
            >
              <SplitSquareHorizontal className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Split editor</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run vitest run src/components/editor/EditorTabs.test.tsx`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/EditorTabs.tsx src/components/editor/EditorTabs.test.tsx
git commit -m "feat(editor): standalone browser button + New Terminal entry"
```

---

## Task 7: EditorGroup — render active TerminalPane

**Files:**
- Modify: `src/components/editor/EditorGroup.tsx`
- Test: `src/components/editor/EditorGroup.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to the existing `describe("EditorGroup", ...)` block in `src/components/editor/EditorGroup.test.tsx`:

```tsx
  it("renders a terminal pane for each terminal tab; only the active one is visible", () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [],
      activeWorkspaceId: null,
      systemTabs: [],
      activeSystemTab: null,
      terminalTabs: [
        { id: "t1", cwd: "/a", title: "a", ptyId: "pty-1" },
        { id: "t2", cwd: "/b", title: "b", ptyId: "pty-2" },
      ],
      activeTerminalTabId: "t1",
    });
    renderWithProviders(<EditorGroup />);
    const active = screen.getByTestId("terminal-tab-content-t1");
    const inactive = screen.getByTestId("terminal-tab-content-t2");
    expect(active).toHaveAttribute("aria-hidden", "false");
    expect(inactive).toHaveAttribute("aria-hidden", "true");
  });

  it("does not show the empty editor when only a terminal tab is open", () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [],
      activeWorkspaceId: null,
      systemTabs: [],
      activeSystemTab: null,
      terminalTabs: [{ id: "t1", cwd: "/a", title: "a", ptyId: "pty-1" }],
      activeTerminalTabId: "t1",
    });
    renderWithProviders(<EditorGroup />);
    expect(screen.queryByTestId("empty-editor")).not.toBeInTheDocument();
  });
```

Add a vi-mock at the top of the file (just below the imports) so `TerminalPane` does not boot xterm in jsdom:

```tsx
vi.mock("./terminal/TerminalPane", () => ({
  TerminalPane: ({ ptyId, paneId }: { ptyId: string; paneId: string }) => (
    <div data-testid={`mock-terminal-pane-${paneId}`} data-pty={ptyId} />
  ),
}));
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run vitest run src/components/editor/EditorGroup.test.tsx`
Expected: FAIL — `terminal-tab-content-t1` not found.

- [ ] **Step 3: Implement `src/components/editor/EditorGroup.tsx`**

Replace the file's contents with:

```tsx
import { lazy, Suspense } from "react";
import { useWorkbench, type SystemTabId } from "@/state/store";
import { EditorTabs } from "./EditorTabs";
import { WorkspaceEditor } from "./WorkspaceEditor";
import { EmptyEditor } from "./EmptyEditor";
import { TerminalPane } from "./terminal/TerminalPane";
import { cn } from "@/lib/utils";

const UsagePanel = lazy(() => import("@/panels/usage/UsagePanel"));
const BrowserPanel = lazy(() => import("@/panels/browser/BrowserPanel"));
const KanbanBoard = lazy(() => import("@/panels/kanban/KanbanBoard"));
const AutomationsPanel = lazy(() => import("@/panels/automations/AutomationsPanel"));
const MCPsPanel = lazy(() => import("@/panels/mcps/MCPsPanel"));

function SystemTabContent({ id }: { id: SystemTabId }) {
  switch (id) {
    case "dashboard":
      return <UsagePanel />;
    case "browser":
      return <BrowserPanel />;
    case "kanban":
      return <KanbanBoard />;
    case "automations":
      return <AutomationsPanel />;
    case "mcps":
      return <MCPsPanel />;
  }
}

export function EditorGroup() {
  const workspaces = useWorkbench((s) => s.workspaces);
  const activeId = useWorkbench((s) => s.activeWorkspaceId);
  const systemTabs = useWorkbench((s) => s.systemTabs);
  const activeSystemTab = useWorkbench((s) => s.activeSystemTab);
  const terminalTabs = useWorkbench((s) => s.terminalTabs);
  const activeTerminalTabId = useWorkbench((s) => s.activeTerminalTabId);

  const hasAnyTabs = workspaces.length > 0 || systemTabs.length > 0 || terminalTabs.length > 0;
  const showEmpty = !hasAnyTabs;
  const showSystemTab = activeSystemTab && systemTabs.includes(activeSystemTab);
  const showTerminalTab = !!activeTerminalTabId && terminalTabs.some((t) => t.id === activeTerminalTabId);

  return (
    <div
      data-testid="editor-group"
      className="mv-editorgroup flex h-full w-full flex-col bg-editor"
    >
      {hasAnyTabs && <EditorTabs />}
      <div className="relative flex-1 overflow-hidden">
        {showEmpty && <EmptyEditor />}

        {workspaces.map((ws) => (
          <WorkspaceEditor
            key={ws.id}
            workspace={ws}
            active={!showSystemTab && !showTerminalTab && ws.id === activeId}
          />
        ))}

        {terminalTabs.map((tab) => {
          const active = showTerminalTab && tab.id === activeTerminalTabId;
          return (
            <div
              key={tab.id}
              data-testid={`terminal-tab-content-${tab.id}`}
              aria-hidden={!active}
              className={cn(
                "absolute inset-0 bg-background",
                !active && "keep-alive-hidden content-visibility-auto"
              )}
            >
              <TerminalPane
                ptyId={tab.ptyId}
                paneId={tab.id}
                isFocused
                onFocus={() => {}}
              />
            </div>
          );
        })}

        {showSystemTab && (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading…
              </div>
            }
          >
            <div className="absolute inset-0 overflow-auto bg-editor">
              <SystemTabContent id={activeSystemTab} />
            </div>
          </Suspense>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run vitest run src/components/editor/EditorGroup.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/EditorGroup.tsx src/components/editor/EditorGroup.test.tsx
git commit -m "feat(editor): render keep-alive TerminalPane for active terminal tab"
```

---

## Task 8: Full suite + manual smoke + coverage

- [ ] **Step 1: Type-check & build**

Run: `bun run build`
Expected: zero TypeScript errors. (The build script is the canonical type-check gate per `CLAUDE.md`.)

- [ ] **Step 2: Rust check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean build.

- [ ] **Step 3: Frontend tests with coverage**

Run: `bun run test:coverage`
Expected: PASS. Coverage thresholds (lines 100, branches 95, functions 100, statements 100) must hold. If coverage dips on the new files, add focused tests covering the missing branches before continuing.

- [ ] **Step 4: Sidecar + Rust tests**

Run: `bun test sidecar/` and `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS for both.

- [ ] **Step 5: Manual smoke in Tauri dev**

Run: `bun run tauri dev`

Verify in the running app:
1. The `Globe` icon appears to the left of the `+` icon in `EditorTabs`. Tooltip says "Open browser ⌘⇧B".
2. Clicking it opens a Browser tab; clicking again with the tab open just re-activates it.
3. Opening the `+` dropdown shows a "New / Terminal" entry above the "Open as tab" group. Browser is **not** in the dropdown.
4. With no workspace open, clicking "Terminal" opens a tab titled `Desktop` (or your first project's folder name if any) and a shell prompt appears in the tab body.
5. With a workspace active, clicking "Terminal" opens a tab whose cwd matches the active workspace's worktree (verify with `pwd` in the shell).
6. Open two terminal tabs; switching between them preserves scrollback in each (keep-alive verification).
7. Closing the X on a terminal tab kills its shell (no zombie processes — verify with `ps` or by reopening DevTools and checking `useWorkbench.getState().terminalTabs`).
8. Opening Tasks (existing system tab) while on a Terminal tab deactivates the terminal cleanly.

- [ ] **Step 6: Commit any documentation refresh that fell out of the smoke test**

If smoke testing reveals nothing to fix, no commit needed. Otherwise:

```bash
git add <files>
git commit -m "chore: smoke-test fixes for terminal tabs"
```

---

## Out of scope reminder

Per spec §"Non-Goals":
- No split-pane inside terminal tabs (single pane only).
- No persistence of terminal tabs across restarts.
- No rename UI.
- No keybinding for "new terminal" (placeholder removed from menu; revisit when wiring CommandPalette).
- No drag-reorder.

---

## Self-Review Notes

**Spec coverage:**
- §1 Store changes → Task 1
- §2 `useTerminalTab` hook → Task 5
- §3 cwd resolver → Task 4
- §4 IPC changes (TS) → Task 2
- §4 IPC changes (Rust) → Task 3
- §5 `default_shell` → Task 3
- §6 UI changes → Task 6
- §7 `EditorGroup` → Task 7
- §8 Tests → covered across Tasks 1–7
- §9 File ownership → no plan changes needed (all in Editor/Terminal + Rust IPC zones)
- §10 Rollout → Task 8 verifies the single-PR flow

**Type/name consistency check:**
- `TerminalTab` shape `{ id, cwd, title, ptyId }` used identically across Tasks 1, 5, 6, 7.
- `addTerminalTab` / `removeTerminalTab` / `setActiveTerminalTab` names consistent across Tasks 1, 5, 6, 7.
- `ptySpawn(workspaceId, command, args, cwd?)` signature consistent across Tasks 2, 5.
- `defaultShell()` exported in Task 2, consumed in Task 5.
- `defaultTerminalCwd()` exported in Task 4, consumed in Task 6.
- Test IDs: `editor-tab-terminal-${id}`, `terminal-tab-content-${id}`, `editor-tabs-browser`, `editor-tabs-open-terminal`, `editor-tabs-open-{dashboard,kanban,automations,mcps}` — referenced consistently in Tasks 6 and 7.
