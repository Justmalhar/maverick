import { describe, it, expect, beforeEach } from "vitest";
import { useWorkbench, selectActiveWorkspace, selectEditorMode, selectWorkspacesForProject } from "./store";
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
});
