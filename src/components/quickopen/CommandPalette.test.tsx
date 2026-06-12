import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup } from "@testing-library/react";
import { renderWithProviders, screen } from "@/test/utils";
import { CommandPalette } from "./CommandPalette";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({
    ...initial,
    commandPaletteOpen: true,
    workspaces: [], activeWorkspaceId: null,
  });
});

describe("CommandPalette", () => {
  it("dispatches each command and closes the palette", async () => {
    useWorkbench.setState({
      ...initial,
      commandPaletteOpen: true,
      workspaces: [makeWorkspace({ id: "w1" })],
      activeWorkspaceId: "w1",
      layout: { ...initial.layout, auxiliaryView: "files", auxiliaryBarVisible: false },
    });
    renderWithProviders(<CommandPalette />);
    await userEvent.click(screen.getByTestId("commandpalette-item-view.git"));
    expect(useWorkbench.getState().layout.auxiliaryView).toBe("scm");
    expect(useWorkbench.getState().layout.auxiliaryBarVisible).toBe(true);
    expect(useWorkbench.getState().commandPaletteOpen).toBe(false);
  });

  it("project.new reveals the primary sidebar", async () => {
    useWorkbench.setState({
      ...initial,
      commandPaletteOpen: true,
      layout: { ...initial.layout, primarySideBarVisible: false },
    });
    renderWithProviders(<CommandPalette />);
    await userEvent.click(screen.getByTestId("commandpalette-item-project.new"));
    expect(useWorkbench.getState().layout.primarySideBarVisible).toBe(true);
  });

  it("global.quickOpen opens the Go to File overlay", async () => {
    renderWithProviders(<CommandPalette />);
    await userEvent.click(screen.getByTestId("commandpalette-item-global.quickOpen"));
    expect(useWorkbench.getState().quickOpenOpen).toBe(true);
    expect(useWorkbench.getState().commandPaletteOpen).toBe(false);
  });

  it("preview.open switches the aux view to preview", async () => {
    renderWithProviders(<CommandPalette />);
    await userEvent.click(screen.getByTestId("commandpalette-item-preview.open"));
    expect(useWorkbench.getState().layout.auxiliaryView).toBe("preview");
    expect(useWorkbench.getState().commandPaletteOpen).toBe(false);
  });

  const cases: Array<[string, (s: ReturnType<typeof useWorkbench.getState>) => unknown]> = [
    ["view.kanban", (s) => expect(s.systemTabs).toContain("kanban")],
    ["view.browser", (s) => expect(s.systemTabs).toContain("browser")],
    ["view.automations", (s) => expect(s.systemTabs).toContain("automations")],
    ["view.mcps", (s) => expect(s.systemTabs).toContain("mcps")],
    ["global.settings", (s) => expect(s.settingsOpen).toBe(true)],
    ["global.presets", (s) => expect(s.presetLauncherOpen).toBe(true)],
    ["layout.toggleSidebar", (s) => expect(s.layout.primarySideBarVisible).toBe(false)],
    ["layout.toggleAuxBar", (s) => expect(s.layout.auxiliaryBarVisible).toBe(false)],
    ["layout.togglePanel", (s) => expect(s.layout.panelVisible).toBe(false)],
  ];

  it.each(cases)("dispatches command %s", async (id, check) => {
    useWorkbench.setState({ ...initial, commandPaletteOpen: true });
    renderWithProviders(<CommandPalette />);
    await userEvent.click(screen.getByTestId(`commandpalette-item-${id}`));
    check(useWorkbench.getState());
    cleanup();
  });

  it("toggle editor mode no-ops without active workspace", async () => {
    useWorkbench.setState({ ...initial, commandPaletteOpen: true, activeWorkspaceId: null, editorModes: {} });
    renderWithProviders(<CommandPalette />);
    await userEvent.click(screen.getByTestId("commandpalette-item-editor.toggleMode"));
    expect(useWorkbench.getState().editorModes).toEqual({});
  });

  it("toggle editor mode flips with active workspace", async () => {
    useWorkbench.setState({
      ...initial,
      commandPaletteOpen: true,
      workspaces: [makeWorkspace({ id: "wA" })],
      activeWorkspaceId: "wA",
      editorModes: {},
    });
    renderWithProviders(<CommandPalette />);
    await userEvent.click(screen.getByTestId("commandpalette-item-editor.toggleMode"));
    expect(useWorkbench.getState().editorModes["wA"]).toBe("terminal");
  });

  it("project-settings.open opens project settings when active workspace exists", async () => {
    useWorkbench.setState({
      ...initial,
      commandPaletteOpen: true,
      workspaces: [makeWorkspace({ id: "w1" })],
      activeWorkspaceId: "w1",
    });
    renderWithProviders(<CommandPalette />);
    await userEvent.click(screen.getByTestId("commandpalette-item-project-settings.open"));
    expect(useWorkbench.getState().projectSettings.open).toBe(true);
  });

  it("project-settings.open is a no-op when no active workspace", async () => {
    useWorkbench.setState({
      ...initial,
      commandPaletteOpen: true,
      workspaces: [],
      activeWorkspaceId: null,
    });
    renderWithProviders(<CommandPalette />);
    await userEvent.click(screen.getByTestId("commandpalette-item-project-settings.open"));
    expect(useWorkbench.getState().projectSettings.open).toBe(false);
  });
});
