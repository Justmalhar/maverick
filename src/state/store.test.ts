import { describe, it, expect, beforeEach } from "vitest";
import {
  useWorkbench,
  selectActiveWorkspace,
  selectEditorMode,
  selectWorkspacesForProject,
  computeLiveWorkspaceIds,
} from "./store";
import { makeProject, makeWorkspace, makeBackend, makeSkill } from "@/test/fixtures";

const initial = useWorkbench.getState();

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

  it("editor mode set + toggle", () => {
    useWorkbench.getState().setEditorMode("w1", "agent");
    expect(useWorkbench.getState().editorModes["w1"]).toBe("agent");
    useWorkbench.getState().toggleEditorMode("w1");
    expect(useWorkbench.getState().editorModes["w1"]).toBe("terminal");
    useWorkbench.getState().toggleEditorMode("w1");
    expect(useWorkbench.getState().editorModes["w1"]).toBe("agent");
    useWorkbench.getState().toggleEditorMode("w2"); // uninitialised → terminal
    expect(useWorkbench.getState().editorModes["w2"]).toBe("terminal");
  });

  it("setSplitTree, setBackends, setSkills", () => {
    useWorkbench.getState().setSplitTree("w1", { type: "terminal", id: "p", backend: "shell", ptyId: "" });
    expect(useWorkbench.getState().splitTrees["w1"]?.type).toBe("terminal");
    useWorkbench.getState().setBackends([makeBackend()]);
    expect(useWorkbench.getState().backends).toHaveLength(1);
    useWorkbench.getState().setSkills([makeSkill()]);
    expect(useWorkbench.getState().skills).toHaveLength(1);
  });

  it("layout toggles and view setters", () => {
    useWorkbench.getState().setActivityView("git");
    expect(useWorkbench.getState().layout.activityView).toBe("git");
    expect(useWorkbench.getState().layout.primarySideBarVisible).toBe(true);
    useWorkbench.getState().setAuxiliaryView("diff");
    expect(useWorkbench.getState().layout.auxiliaryView).toBe("diff");

    useWorkbench.getState().togglePrimarySideBar();
    expect(useWorkbench.getState().layout.primarySideBarVisible).toBe(false);
    useWorkbench.getState().toggleAuxiliaryBar();
    expect(useWorkbench.getState().layout.auxiliaryBarVisible).toBe(false);
    useWorkbench.getState().togglePanel();
    expect(useWorkbench.getState().layout.panelVisible).toBe(true);

    useWorkbench.getState().setPrimarySideBarWidth(200);
    useWorkbench.getState().setAuxiliaryBarWidth(220);
    useWorkbench.getState().setPanelHeight(150);
    expect(useWorkbench.getState().layout.primarySideBarWidth).toBe(200);
    expect(useWorkbench.getState().layout.auxiliaryBarWidth).toBe(220);
    expect(useWorkbench.getState().layout.panelHeight).toBe(150);
  });

  it("preview open/close/toggle-raw actions", () => {
    useWorkbench.getState().openPreview({ path: "/wt/a.md", name: "a.md" });
    let s = useWorkbench.getState();
    expect(s.previewFile).toEqual({ path: "/wt/a.md", name: "a.md" });
    expect(s.layout.auxiliaryView).toBe("preview");
    expect(s.layout.auxiliaryBarVisible).toBe(true);

    useWorkbench.getState().togglePreviewRaw();
    expect(useWorkbench.getState().previewFile?.raw).toBe(true);
    useWorkbench.getState().togglePreviewRaw();
    expect(useWorkbench.getState().previewFile?.raw).toBe(false);

    useWorkbench.getState().closePreview();
    expect(useWorkbench.getState().previewFile).toBeNull();

    // toggle-raw with no preview file is a no-op.
    useWorkbench.getState().togglePreviewRaw();
    expect(useWorkbench.getState().previewFile).toBeNull();
  });

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

    expect(selectEditorMode("wA")(useWorkbench.getState())).toBe("agent");
    useWorkbench.getState().setEditorMode("wA", "terminal");
    expect(selectEditorMode("wA")(useWorkbench.getState())).toBe("terminal");

    expect(selectWorkspacesForProject("p1")(useWorkbench.getState())).toHaveLength(1);
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
