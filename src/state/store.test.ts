import { describe, it, expect, beforeEach, vi } from "vitest";
import * as scriptRunner from "@/lib/script-runner";
import {
  useWorkbench,
  selectActiveWorkspace,
  selectContextWorkspace,
  selectWorkspacesForProject,
  computeLiveWorkspaceIds,
  computeLiveFileTabIds,
  type FileTab,
} from "./store";
import { makeProject, makeWorkspace, makeBackend, makeSkill } from "@/test/fixtures";

let tabCounter = 0;
function makeTab(overrides: Partial<FileTab> = {}): FileTab {
  const path = `/wt/file-${tabCounter++}.ts`;
  return {
    id: `file:${path}`,
    kind: "file",
    path,
    worktreePath: "/wt",
    workspaceId: null,
    preview: false,
    dirty: false,
    mode: "edit",
    viewed: false,
    ...overrides,
  };
}

const initial = useWorkbench.getState();

beforeEach(() => {
  tabCounter = 0;
  useWorkbench.setState({
    ...initial,
    projects: [],
    workspaces: [],
    backends: [],
    skills: [],
    activeWorkspaceId: null,
    splitTrees: {},
    launchSpecs: {},
    terminalTabs: [],
    activeTerminalTabId: null,
    terminalGroups: [],
    activeGroupByWorkspace: {},
    systemTabs: [],
    activeSystemTab: null,
    fileTabs: [],
    activeFileTabId: null,
    fileTabAccessOrder: [],
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
      auxiliaryView: "files",
    },
  });
});

describe("workbench store", () => {
  it("setProjects + addProject", () => {
    useWorkbench.getState().setProjects([makeProject({ id: "a" })]);
    expect(useWorkbench.getState().projects).toHaveLength(1);
    useWorkbench.getState().addProject(makeProject({ id: "b" }));
    expect(useWorkbench.getState().projects.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("workspace add/remove/update + activeWorkspace clearing", () => {
    const ws1 = makeWorkspace({ id: "w1" });
    const ws2 = makeWorkspace({ id: "w2" });
    useWorkbench.getState().setWorkspaces([ws1]);
    useWorkbench.getState().addWorkspace(ws2);
    useWorkbench.getState().setActiveWorkspace("w2");
    expect(useWorkbench.getState().activeWorkspaceId).toBe("w2");

    useWorkbench.getState().updateWorkspace("w1", { branch: "feat" });
    expect(useWorkbench.getState().workspaces.find((w) => w.id === "w1")?.branch).toBe("feat");

    useWorkbench.getState().removeWorkspace("w2");
    expect(useWorkbench.getState().activeWorkspaceId).toBeNull();
    expect(useWorkbench.getState().workspaces.find((w) => w.id === "w2")).toBeUndefined();

    useWorkbench.getState().setActiveWorkspace("w1");
    useWorkbench.getState().removeWorkspace("w-other");
    expect(useWorkbench.getState().activeWorkspaceId).toBe("w1");
  });

  it("removeWorkspace disposes that workspace's Run/Setup runners", () => {
    const spy = vi.spyOn(scriptRunner, "disposeWorkspaceRunners").mockImplementation(() => {});
    useWorkbench.getState().setWorkspaces([makeWorkspace({ id: "w-kill" })]);
    useWorkbench.getState().removeWorkspace("w-kill");
    expect(spy).toHaveBeenCalledWith("w-kill");
    spy.mockRestore();
  });

  it("removeWorkspace kills the workspace's leaf shell PTYs (#17)", async () => {
    const { __testing__ } = await import("@/components/editor/terminal/leaf-registry");
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockClear();
    // Seed two live leaf PTYs for the workspace (ids are `${workspaceId}-…`).
    __testing__.leafPtyCache.set("w-pty-1", "pty-aaa");
    __testing__.leafPtyCache.set("w-pty-2", "pty-bbb");
    useWorkbench.getState().setWorkspaces([makeWorkspace({ id: "w-pty" })]);
    useWorkbench.getState().removeWorkspace("w-pty");
    // Both leaves evicted and killed — closing a tab must not orphan a shell.
    expect(__testing__.leafPtyCache.has("w-pty-1")).toBe(false);
    expect(__testing__.leafPtyCache.has("w-pty-2")).toBe(false);
    expect(invoke).toHaveBeenCalledWith("pty_kill", { ptyId: "pty-aaa" });
    expect(invoke).toHaveBeenCalledWith("pty_kill", { ptyId: "pty-bbb" });
  });

  it("removeWorkspace kills leaves for extra terminal groups too", async () => {
    const { __testing__ } = await import("@/components/editor/terminal/leaf-registry");
    useWorkbench.getState().addWorkspace(makeWorkspace({ id: "w1" }));
    const id = useWorkbench.getState().addTerminalGroup("w1");
    __testing__.leafPtyCache.set("w1-1", "pty-primary");
    __testing__.leafPtyCache.set(`${id}-1`, "pty-extra");
    useWorkbench.getState().removeWorkspace("w1");
    expect(__testing__.leafPtyCache.has("w1-1")).toBe(false);
    expect(__testing__.leafPtyCache.has(`${id}-1`)).toBe(false);
  });

  it("removeWorkspace prunes the workspace's split tree (#40m)", () => {
    useWorkbench.getState().setWorkspaces([makeWorkspace({ id: "w-tree" })]);
    useWorkbench.getState().setSplitTree("w-tree", { type: "terminal", id: "w-tree-1", backend: "shell", ptyId: "" });
    useWorkbench.getState().removeWorkspace("w-tree");
    expect(useWorkbench.getState().splitTrees["w-tree"]).toBeUndefined();
  });

  it("tracks workspace access order (MRU first) across add/activate/remove", () => {
    const wsA = makeWorkspace({ id: "a" });
    const wsB = makeWorkspace({ id: "b" });
    useWorkbench.getState().addWorkspace(wsA);
    useWorkbench.getState().addWorkspace(wsB);
    // addWorkspace prepends → most recent first
    expect(useWorkbench.getState().workspaceAccessOrder).toEqual(["b", "a"]);

    useWorkbench.getState().setActiveWorkspace("a");
    expect(useWorkbench.getState().workspaceAccessOrder).toEqual(["a", "b"]);

    useWorkbench.getState().setActiveWorkspace(null);
    // null active leaves order unchanged
    expect(useWorkbench.getState().workspaceAccessOrder).toEqual(["a", "b"]);

    useWorkbench.getState().removeWorkspace("a");
    expect(useWorkbench.getState().workspaceAccessOrder).toEqual(["b"]);

    // setWorkspaces prunes ids that no longer exist
    useWorkbench.getState().setWorkspaces([makeWorkspace({ id: "b" })]);
    expect(useWorkbench.getState().workspaceAccessOrder).toEqual(["b"]);
    useWorkbench.getState().setWorkspaces([]);
    expect(useWorkbench.getState().workspaceAccessOrder).toEqual([]);
  });

  it("launch spec set + consume is single-shot", () => {
    const spec = { command: "claude", args: ["--model", "opus"], prompt: "fix it" };
    useWorkbench.getState().setLaunchSpec("w1", spec);
    expect(useWorkbench.getState().launchSpecs["w1"]).toEqual(spec);
    // First consume returns the spec and removes it.
    expect(useWorkbench.getState().consumeLaunchSpec("w1")).toEqual(spec);
    expect(useWorkbench.getState().launchSpecs["w1"]).toBeUndefined();
    // Second consume yields null (single-shot).
    expect(useWorkbench.getState().consumeLaunchSpec("w1")).toBeNull();
  });

  it("consumeLaunchSpec returns null for an unknown workspace", () => {
    expect(useWorkbench.getState().consumeLaunchSpec("nope")).toBeNull();
  });

  it("removeWorkspace clears a pending launch spec", () => {
    useWorkbench.getState().addWorkspace(makeWorkspace({ id: "w9", projectId: "p1" }));
    useWorkbench.getState().setLaunchSpec("w9", { command: "codex", args: [] });
    useWorkbench.getState().removeWorkspace("w9");
    expect(useWorkbench.getState().launchSpecs["w9"]).toBeUndefined();
  });

  it("setSplitTree, setBackends, setSkills", () => {
    useWorkbench.getState().setSplitTree("w1", { type: "terminal", id: "p", backend: "shell", ptyId: "" });
    expect(useWorkbench.getState().splitTrees["w1"]?.type).toBe("terminal");
    useWorkbench.getState().setBackends([makeBackend()]);
    expect(useWorkbench.getState().backends).toHaveLength(1);
    useWorkbench.getState().setSkills([makeSkill()]);
    expect(useWorkbench.getState().skills).toHaveLength(1);
  });

  it("queueSetup adds once and ignores duplicates; clearPendingSetup removes", () => {
    useWorkbench.getState().queueSetup("w-setup");
    useWorkbench.getState().queueSetup("w-setup");
    expect(useWorkbench.getState().pendingSetupIds).toEqual(["w-setup"]);
    expect(useWorkbench.getState().layout.panelVisible).toBe(true);
    useWorkbench.getState().clearPendingSetup("w-setup");
    expect(useWorkbench.getState().pendingSetupIds).toEqual([]);
  });

  it("layout toggles and view setters", () => {
    useWorkbench.setState({
      layout: { ...useWorkbench.getState().layout, primarySideBarVisible: false, auxiliaryBarVisible: false },
    });
    useWorkbench.getState().showPrimarySideBar();
    expect(useWorkbench.getState().layout.primarySideBarVisible).toBe(true);
    useWorkbench.getState().openSourceControl();
    expect(useWorkbench.getState().layout.auxiliaryView).toBe("scm");
    expect(useWorkbench.getState().layout.auxiliaryBarVisible).toBe(true);
    useWorkbench.getState().setAuxiliaryView("diff");
    expect(useWorkbench.getState().layout.auxiliaryView).toBe("diff");

    useWorkbench.getState().togglePrimarySideBar();
    expect(useWorkbench.getState().layout.primarySideBarVisible).toBe(false);
    useWorkbench.getState().toggleAuxiliaryBar();
    expect(useWorkbench.getState().layout.auxiliaryBarVisible).toBe(false);
    useWorkbench.getState().togglePanel();
    expect(useWorkbench.getState().layout.panelVisible).toBe(true);

    useWorkbench.getState().setActivitybarCollapsed(true);
    expect(useWorkbench.getState().layout.activitybarCollapsed).toBe(true);
    useWorkbench.getState().toggleActivitybarCollapsed();
    expect(useWorkbench.getState().layout.activitybarCollapsed).toBe(false);
    useWorkbench.getState().toggleActivitybarCollapsed();
    expect(useWorkbench.getState().layout.activitybarCollapsed).toBe(true);

    useWorkbench.getState().setPrimarySideBarWidth(200);
    useWorkbench.getState().setAuxiliaryBarWidth(220);
    useWorkbench.getState().setPanelHeight(150);
    expect(useWorkbench.getState().layout.primarySideBarWidth).toBe(200);
    expect(useWorkbench.getState().layout.auxiliaryBarWidth).toBe(220);
    expect(useWorkbench.getState().layout.panelHeight).toBe(150);
  });

  // preview open/close/toggle-raw removed — preview is now a file tab (B4).

  it("overlays setters", () => {
    useWorkbench.getState().setCommandPaletteOpen(true);
    useWorkbench.getState().setQuickOpenOpen(true);
    useWorkbench.getState().setPresetLauncherOpen(true);
    useWorkbench.getState().setKeybindingHelpOpen(true);
    useWorkbench.getState().setSettingsOpen(true);
    const s = useWorkbench.getState();
    expect(s.commandPaletteOpen && s.quickOpenOpen && s.presetLauncherOpen).toBe(true);
    expect(s.keybindingHelpOpen && s.settingsOpen).toBe(true);
  });

  it("activating a workspace clears the active system tab (and vice versa)", () => {
    useWorkbench.getState().setWorkspaces([makeWorkspace({ id: "wA" })]);
    // Open a system tab (e.g. Kanban) — this is the active editor.
    useWorkbench.getState().openSystemTab("kanban");
    expect(useWorkbench.getState().activeSystemTab).toBe("kanban");
    expect(useWorkbench.getState().activeWorkspaceId).toBeNull();

    // Clicking a workspace tab must switch away from the system tab.
    useWorkbench.getState().setActiveWorkspace("wA");
    expect(useWorkbench.getState().activeWorkspaceId).toBe("wA");
    expect(useWorkbench.getState().activeSystemTab).toBeNull();

    // Re-selecting the system tab clears the active workspace again.
    useWorkbench.getState().setActiveSystemTab("kanban");
    expect(useWorkbench.getState().activeSystemTab).toBe("kanban");
    expect(useWorkbench.getState().activeWorkspaceId).toBeNull();
  });

  it("selectors", () => {
    const ws = makeWorkspace({ id: "wA", projectId: "p1" });
    useWorkbench.getState().setWorkspaces([ws, makeWorkspace({ id: "wB", projectId: "p2" })]);
    useWorkbench.getState().setActiveWorkspace("wA");
    expect(selectActiveWorkspace(useWorkbench.getState())?.id).toBe("wA");

    useWorkbench.getState().setActiveWorkspace(null);
    expect(selectActiveWorkspace(useWorkbench.getState())).toBeUndefined();

    expect(selectWorkspacesForProject("p1")(useWorkbench.getState())).toHaveLength(1);
  });

  it("selectContextWorkspace recovers the worktree from the active file tab", () => {
    const ws = makeWorkspace({ id: "wA", worktreePath: "/wt" });
    useWorkbench.getState().setWorkspaces([ws]);
    useWorkbench.getState().setActiveWorkspace("wA");
    // Active workspace wins.
    expect(selectContextWorkspace(useWorkbench.getState())?.id).toBe("wA");

    // Opening a file/diff clears activeWorkspaceId; context falls back to the
    // workspace whose worktree matches the active file tab.
    useWorkbench.getState().openFileTab({
      kind: "diff",
      path: "/wt/src/a.ts",
      worktreePath: "/wt",
      preview: true,
    });
    expect(useWorkbench.getState().activeWorkspaceId).toBeNull();
    expect(selectContextWorkspace(useWorkbench.getState())?.id).toBe("wA");

    // No active workspace and no matching file tab → undefined.
    useWorkbench.getState().closeFileTab("diff:/wt/src/a.ts");
    expect(selectContextWorkspace(useWorkbench.getState())).toBeUndefined();
  });

  it("openProjectSettings sets projectId and section, marks open", () => {
    useWorkbench.getState().openProjectSettings({
      projectId: "p1",
      initialSection: "scripts",
      focusField: "setup",
    });
    const ps = useWorkbench.getState().projectSettings;
    expect(ps.open).toBe(true);
    expect(ps.projectId).toBe("p1");
    expect(ps.initialSection).toBe("scripts");
    expect(ps.focusField).toBe("setup");
  });

  it("closeProjectSettings clears projectId", () => {
    useWorkbench.getState().openProjectSettings({ projectId: "p1" });
    useWorkbench.getState().closeProjectSettings();
    const ps = useWorkbench.getState().projectSettings;
    expect(ps.open).toBe(false);
    expect(ps.projectId).toBeNull();
  });

  it("terminal tabs: add, remove, set active, mutual exclusivity", () => {
    const tab1 = { id: "t1", cwd: "/Users/me/Desktop", title: "Desktop", ptyId: "pty-1" };
    const tab2 = { id: "t2", cwd: "/Users/me/code", title: "code", ptyId: "pty-2" };

    useWorkbench.getState().addTerminalTab(tab1);
    useWorkbench.getState().addTerminalTab(tab2);
    expect(useWorkbench.getState().terminalTabs.map((t) => t.id)).toEqual(["t1", "t2"]);

    // duplicate add is a no-op
    useWorkbench.getState().addTerminalTab(tab1);
    expect(useWorkbench.getState().terminalTabs).toHaveLength(2);

    // setActiveTerminalTab nulls workspace and system tab actives
    useWorkbench.setState({ activeWorkspaceId: "w1", activeSystemTab: "browser" });
    useWorkbench.getState().setActiveTerminalTab("t2");
    expect(useWorkbench.getState().activeTerminalTabId).toBe("t2");
    expect(useWorkbench.getState().activeWorkspaceId).toBeNull();
    expect(useWorkbench.getState().activeSystemTab).toBeNull();

    // setActiveWorkspace nulls activeTerminalTabId AND activeSystemTab
    useWorkbench.setState({ activeSystemTab: "browser", activeTerminalTabId: "t1" });
    useWorkbench.getState().setActiveWorkspace("w1");
    expect(useWorkbench.getState().activeTerminalTabId).toBeNull();
    expect(useWorkbench.getState().activeSystemTab).toBeNull();

    // openSystemTab nulls activeTerminalTabId
    useWorkbench.getState().setActiveTerminalTab("t1");
    useWorkbench.getState().openSystemTab("browser");
    expect(useWorkbench.getState().activeTerminalTabId).toBeNull();

    // setActiveSystemTab with a non-null id nulls activeTerminalTabId and activeWorkspaceId
    useWorkbench.setState({ activeWorkspaceId: "w1", activeTerminalTabId: "t1" });
    useWorkbench.getState().setActiveSystemTab("browser");
    expect(useWorkbench.getState().activeWorkspaceId).toBeNull();
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

  it("setTerminalTabPty binds a spawned PTY to a pending tab and ignores unknown ids", () => {
    useWorkbench.getState().addTerminalTab({ id: "t1", cwd: "/a", title: "a", ptyId: "" });
    useWorkbench.getState().setTerminalTabPty("t1", "pty-99");
    expect(useWorkbench.getState().terminalTabs.find((t) => t.id === "t1")?.ptyId).toBe("pty-99");
    // a non-matching id leaves every tab untouched
    useWorkbench.getState().setTerminalTabPty("nope", "pty-x");
    expect(useWorkbench.getState().terminalTabs.find((t) => t.id === "t1")?.ptyId).toBe("pty-99");
  });
});

describe("computeLiveWorkspaceIds", () => {
  const ws = (id: string) => makeWorkspace({ id });

  it("keeps every workspace live when at or below the limit", () => {
    const list = [ws("a"), ws("b"), ws("c")];
    const live = computeLiveWorkspaceIds(list, ["c", "b", "a"], "c", 8);
    expect(live).toEqual(new Set(["a", "b", "c"]));
  });

  it("suspends the least-recently-used workspaces beyond the limit", () => {
    const list = [ws("a"), ws("b"), ws("c"), ws("d")];
    // MRU first: d, c, b, a — with limit 2 only d and c stay live.
    const live = computeLiveWorkspaceIds(list, ["d", "c", "b", "a"], "d", 2);
    expect(live).toEqual(new Set(["d", "c"]));
    expect(live.has("a")).toBe(false);
    expect(live.has("b")).toBe(false);
  });

  it("always keeps the active workspace live even if it is the LRU tail", () => {
    const list = [ws("a"), ws("b"), ws("c"), ws("d")];
    // Window of 2 = {a, b}; active 'd' is the stale tail but is force-kept live.
    const live = computeLiveWorkspaceIds(list, ["a", "b", "c", "d"], "d", 2);
    expect(live.has("a")).toBe(true);
    expect(live.has("b")).toBe(true);
    expect(live.has("d")).toBe(true); // active, force-kept
    expect(live.has("c")).toBe(false); // suspended
  });

  it("appends open workspaces missing from the access order", () => {
    const list = [ws("a"), ws("b"), ws("c")];
    // 'c' never recorded in access order (e.g. restored from disk).
    const live = computeLiveWorkspaceIds(list, ["a", "b"], null, 3);
    expect(live).toEqual(new Set(["a", "b", "c"]));
  });

  it("treats a non-positive limit as no suspension", () => {
    const list = [ws("a"), ws("b")];
    expect(computeLiveWorkspaceIds(list, ["a", "b"], "a", 0)).toEqual(new Set(["a", "b"]));
  });
});

describe("computeLiveFileTabIds", () => {
  it("keeps every tab live when at or below the limit", () => {
    const tabs = [makeTab(), makeTab(), makeTab()];
    const order = tabs.map((t) => t.id);
    const live = computeLiveFileTabIds(tabs, order, tabs[0].id, 8);
    expect(live).toEqual(new Set(tabs.map((t) => t.id)));
  });

  it("suspends least-recently-used clean tabs beyond the limit", () => {
    const [a, b, c, d] = [makeTab(), makeTab(), makeTab(), makeTab()];
    // MRU first: d, c, b, a — with limit 2 only d and c stay live.
    const live = computeLiveFileTabIds([a, b, c, d], [d.id, c.id, b.id, a.id], d.id, 2);
    expect(live.has(d.id)).toBe(true);
    expect(live.has(c.id)).toBe(true);
    expect(live.has(b.id)).toBe(false);
    expect(live.has(a.id)).toBe(false);
  });

  it("always keeps the active tab live even if it is the LRU tail", () => {
    const [a, b, c, d] = [makeTab(), makeTab(), makeTab(), makeTab()];
    // Window of 2 = {a, b}; active 'd' is the stale tail but must be force-kept.
    const live = computeLiveFileTabIds([a, b, c, d], [a.id, b.id, c.id, d.id], d.id, 2);
    expect(live.has(a.id)).toBe(true);
    expect(live.has(b.id)).toBe(true);
    expect(live.has(d.id)).toBe(true); // active, force-kept
    expect(live.has(c.id)).toBe(false); // suspended
  });

  it("always keeps dirty tabs live regardless of LRU position", () => {
    const clean1 = makeTab();
    const dirty = makeTab({ dirty: true });
    const clean2 = makeTab();
    const clean3 = makeTab();
    // MRU order: clean1, clean2, dirty, clean3 — limit 2 → window = {clean1, clean2}
    // dirty must be added anyway because dirty: true.
    const live = computeLiveFileTabIds(
      [clean1, dirty, clean2, clean3],
      [clean1.id, clean2.id, dirty.id, clean3.id],
      clean1.id,
      2
    );
    expect(live.has(clean1.id)).toBe(true);
    expect(live.has(clean2.id)).toBe(true);
    expect(live.has(dirty.id)).toBe(true); // force-kept: dirty
    expect(live.has(clean3.id)).toBe(false);
  });

  it("appends tabs missing from the access order (e.g. restored from disk)", () => {
    const [a, b, c] = [makeTab(), makeTab(), makeTab()];
    // 'c' was never recorded in access order.
    const live = computeLiveFileTabIds([a, b, c], [a.id, b.id], null, 3);
    expect(live).toEqual(new Set([a.id, b.id, c.id]));
  });

  it("treats a non-positive limit as no suspension", () => {
    const tabs = [makeTab(), makeTab()];
    const live = computeLiveFileTabIds(tabs, tabs.map((t) => t.id), tabs[0].id, 0);
    expect(live).toEqual(new Set(tabs.map((t) => t.id)));
  });
});

describe("fileTabAccessOrder mutations", () => {
  beforeEach(() => {
    useWorkbench.setState({
      ...useWorkbench.getState(),
      fileTabs: [],
      activeFileTabId: null,
      fileTabAccessOrder: [],
    });
  });

  it("openFileTab prepends the id (MRU first)", () => {
    useWorkbench.getState().openFileTab({ kind: "file", path: "/wt/a.ts", worktreePath: "/wt", preview: false });
    useWorkbench.getState().openFileTab({ kind: "file", path: "/wt/b.ts", worktreePath: "/wt", preview: false });
    expect(useWorkbench.getState().fileTabAccessOrder).toEqual(["file:/wt/b.ts", "file:/wt/a.ts"]);
  });

  it("openFileTab on existing tab moves it to front", () => {
    useWorkbench.getState().openFileTab({ kind: "file", path: "/wt/a.ts", worktreePath: "/wt", preview: false });
    useWorkbench.getState().openFileTab({ kind: "file", path: "/wt/b.ts", worktreePath: "/wt", preview: false });
    useWorkbench.getState().openFileTab({ kind: "file", path: "/wt/a.ts", worktreePath: "/wt", preview: false });
    expect(useWorkbench.getState().fileTabAccessOrder[0]).toBe("file:/wt/a.ts");
  });

  it("setActiveFileTab moves id to front", () => {
    useWorkbench.getState().openFileTab({ kind: "file", path: "/wt/a.ts", worktreePath: "/wt", preview: false });
    useWorkbench.getState().openFileTab({ kind: "file", path: "/wt/b.ts", worktreePath: "/wt", preview: false });
    useWorkbench.getState().setActiveFileTab("file:/wt/a.ts");
    expect(useWorkbench.getState().fileTabAccessOrder[0]).toBe("file:/wt/a.ts");
  });

  it("setActiveFileTab(null) leaves access order unchanged", () => {
    useWorkbench.getState().openFileTab({ kind: "file", path: "/wt/a.ts", worktreePath: "/wt", preview: false });
    useWorkbench.getState().openFileTab({ kind: "file", path: "/wt/b.ts", worktreePath: "/wt", preview: false });
    const orderBefore = [...useWorkbench.getState().fileTabAccessOrder];
    useWorkbench.getState().setActiveFileTab(null);
    expect(useWorkbench.getState().fileTabAccessOrder).toEqual(orderBefore);
  });

  it("closeFileTab prunes the id from access order", () => {
    useWorkbench.getState().openFileTab({ kind: "file", path: "/wt/a.ts", worktreePath: "/wt", preview: false });
    useWorkbench.getState().openFileTab({ kind: "file", path: "/wt/b.ts", worktreePath: "/wt", preview: false });
    useWorkbench.getState().closeFileTab("file:/wt/a.ts");
    expect(useWorkbench.getState().fileTabAccessOrder).toEqual(["file:/wt/b.ts"]);
  });
});

function freshWorkspace(id: string) {
  return {
    id, projectId: "p1", branch: "b", agentBackend: "claude",
    worktreePath: `/wt/${id}`, status: "active" as const, sessionId: "s",
  };
}

describe("terminal groups", () => {
  beforeEach(() => {
    useWorkbench.setState({
      workspaces: [], terminalGroups: [], activeGroupByWorkspace: {},
      splitTrees: {}, activeWorkspaceId: null,
    });
  });

  it("seeds a primary group (id === workspace.id) on addWorkspace", () => {
    useWorkbench.getState().addWorkspace(freshWorkspace("w1"));
    const groups = useWorkbench.getState().terminalGroups;
    expect(groups).toEqual([{ id: "w1", workspaceId: "w1", title: "Terminal 1" }]);
    expect(useWorkbench.getState().activeGroupByWorkspace.w1).toBe("w1");
  });

  it("addTerminalGroup appends an extra group and activates it", () => {
    const s = useWorkbench.getState();
    s.addWorkspace(freshWorkspace("w1"));
    const id = useWorkbench.getState().addTerminalGroup("w1");
    expect(id).toMatch(/^term-/);
    const groups = useWorkbench.getState().terminalGroups.filter((g) => g.workspaceId === "w1");
    expect(groups.map((g) => g.id)).toEqual(["w1", id]);
    expect(groups[1].title).toBe("Terminal 2");
    expect(useWorkbench.getState().activeGroupByWorkspace.w1).toBe(id);
  });

  it("closeTerminalGroup removes an extra group, deletes its tree, re-points active", () => {
    useWorkbench.getState().addWorkspace(freshWorkspace("w1"));
    const id = useWorkbench.getState().addTerminalGroup("w1");
    useWorkbench.setState((st) => ({ splitTrees: { ...st.splitTrees, [id]: { type: "terminal", id: `${id}-1`, backend: "claude", ptyId: id } } }));
    useWorkbench.getState().closeTerminalGroup(id);
    expect(useWorkbench.getState().terminalGroups.find((g) => g.id === id)).toBeUndefined();
    expect(useWorkbench.getState().splitTrees[id]).toBeUndefined();
    expect(useWorkbench.getState().activeGroupByWorkspace.w1).toBe("w1");
  });

  it("closeTerminalGroup is a no-op for a primary group", () => {
    useWorkbench.getState().addWorkspace(freshWorkspace("w1"));
    useWorkbench.getState().closeTerminalGroup("w1");
    expect(useWorkbench.getState().terminalGroups.find((g) => g.id === "w1")).toBeDefined();
  });

  it("setActiveGroup updates the active group for a workspace", () => {
    useWorkbench.getState().addWorkspace(freshWorkspace("w1"));
    const id = useWorkbench.getState().addTerminalGroup("w1");
    useWorkbench.getState().setActiveGroup("w1", "w1");
    expect(useWorkbench.getState().activeGroupByWorkspace.w1).toBe("w1");
    useWorkbench.getState().setActiveGroup("w1", id);
    expect(useWorkbench.getState().activeGroupByWorkspace.w1).toBe(id);
  });

  it("removeWorkspace drops all groups, trees and active-group entry", () => {
    useWorkbench.getState().addWorkspace(freshWorkspace("w1"));
    const id = useWorkbench.getState().addTerminalGroup("w1");
    useWorkbench.getState().removeWorkspace("w1");
    expect(useWorkbench.getState().terminalGroups).toEqual([]);
    expect(useWorkbench.getState().splitTrees[id]).toBeUndefined();
    expect(useWorkbench.getState().activeGroupByWorkspace.w1).toBeUndefined();
  });

  it("setWorkspaces seeds primary groups and prunes stale ones", () => {
    useWorkbench.getState().addWorkspace(freshWorkspace("w1"));
    useWorkbench.getState().addTerminalGroup("w1");
    useWorkbench.getState().setWorkspaces([freshWorkspace("w2")]);
    const groups = useWorkbench.getState().terminalGroups;
    expect(groups).toEqual([{ id: "w2", workspaceId: "w2", title: "Terminal 1" }]);
    expect(useWorkbench.getState().activeGroupByWorkspace.w1).toBeUndefined();
    expect(useWorkbench.getState().activeGroupByWorkspace.w2).toBe("w2");
  });
});
