import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { Workbench } from "./Workbench";
import { useWorkbench } from "@/state/store";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import { makeWorkspace, makeProject } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue([] as never);
  useWorkbench.setState({
    ...initial,
    workspaces: [], projects: [], activeWorkspaceId: null,
    commandPaletteOpen: false, quickOpenOpen: false, presetLauncherOpen: false, settingsOpen: false,
    layout: { ...initial.layout, primarySideBarVisible: true, auxiliaryBarVisible: true, panelVisible: true },
  });
});

describe("Workbench", () => {
  it("renders the full Workbench shell with both sidebars and bottom panel", async () => {
    renderWithProviders(<Workbench />);
    expect(screen.getByTestId("workbench")).toBeInTheDocument();
    expect(screen.getByTestId("titlebar")).toBeInTheDocument();
    expect(screen.getByTestId("activitybar")).toBeInTheDocument();
    expect(screen.getByTestId("statusbar")).toBeInTheDocument();
    expect(screen.getByTestId("primarysidebar-panel")).toBeInTheDocument();
    expect(screen.getByTestId("auxiliarybar-panel")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("bottom-panel")).toBeInTheDocument());
  });

  it("hides primary sidebar and bottom panel when toggled off", () => {
    useWorkbench.setState({
      ...initial,
      layout: { ...initial.layout, primarySideBarVisible: false, panelVisible: false, auxiliaryBarVisible: false },
    });
    renderWithProviders(<Workbench />);
    expect(screen.queryByTestId("primarysidebar-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bottom-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("auxiliarybar-panel")).not.toBeInTheDocument();
  });

  it("lazy-renders settings panel when settings is open and closes via Escape", async () => {
    useWorkbench.setState({ ...initial, settingsOpen: true });
    renderWithProviders(<Workbench />);
    await waitFor(() => expect(screen.getByTestId("settings-panel")).toBeInTheDocument());
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await waitFor(() => expect(useWorkbench.getState().settingsOpen).toBe(false));
  });

  it("renders ProjectSettingsPanel when projectSettings.open is true", async () => {
    useWorkbench.setState({
      ...initial,
      projectSettings: { open: true, projectId: "p1", initialSection: undefined, focusField: undefined },
    });
    renderWithProviders(<Workbench />);
    await waitFor(() => expect(screen.getByTestId("project-settings-panel")).toBeInTheDocument());
  });

  it("closes project settings panel when Escape is pressed", async () => {
    useWorkbench.setState({
      ...initial,
      projectSettings: { open: true, projectId: "p1", initialSection: undefined, focusField: undefined },
    });
    renderWithProviders(<Workbench />);
    await waitFor(() => expect(screen.getByTestId("project-settings-panel")).toBeInTheDocument());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(useWorkbench.getState().projectSettings.open).toBe(false));
  });

  it("auto-loads project settings when active workspace has a project", async () => {
    const loadSpy = vi.spyOn(useProjectSettingsStore.getState(), "load").mockResolvedValue();
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1" })],
      workspaces: [makeWorkspace({ id: "w1", projectId: "p1" })],
      activeWorkspaceId: "w1",
    });
    renderWithProviders(<Workbench />);
    await waitFor(() => expect(loadSpy).toHaveBeenCalledWith("p1"));
    loadSpy.mockRestore();
  });

  it("onProjectSettingsChanged updates store when projectId matches and dirty is empty", async () => {
    let capturedHandler: ((e: { payload: unknown }) => void) | null = null;
    vi.mocked(listen).mockImplementation((event, handler) => {
      if (event === "project:settings:changed") {
        capturedHandler = handler as (e: { payload: unknown }) => void;
      }
      return Promise.resolve(() => {});
    });
    useProjectSettingsStore.setState({
      projectId: "p1", data: null, status: "loaded", dirty: {}, lastError: null,
    });
    renderWithProviders(<Workbench />);
    await waitFor(() => expect(capturedHandler).not.toBeNull());
    const newSettings = { name: "updated", rootPath: "/p", workspaces: { branchFrom: "main", filesToCopy: [] }, remote: "origin", previewUrl: "", scripts: { setup: "", run: "", archive: "" }, preferences: {} };
    capturedHandler!({ payload: { projectId: "p1", settings: newSettings } });
    expect(useProjectSettingsStore.getState().data).toEqual(newSettings);
    vi.mocked(listen).mockReset().mockResolvedValue(() => {});
  });

  it("onProjectSettingsChanged warns and keeps dirty state when dirty changes exist", async () => {
    let capturedHandler: ((e: { payload: unknown }) => void) | null = null;
    vi.mocked(listen).mockImplementation((event, handler) => {
      if (event === "project:settings:changed") {
        capturedHandler = handler as (e: { payload: unknown }) => void;
      }
      return Promise.resolve(() => {});
    });
    useProjectSettingsStore.setState({
      projectId: "p1", data: null, status: "loaded", dirty: { name: "edited" }, lastError: null,
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderWithProviders(<Workbench />);
    await waitFor(() => expect(capturedHandler).not.toBeNull());
    capturedHandler!({ payload: { projectId: "p1", settings: {} } });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("keep editing wins"));
    expect(useProjectSettingsStore.getState().data).toBeNull();
    warnSpy.mockRestore();
    vi.mocked(listen).mockReset().mockResolvedValue(() => {});
  });

  it("onProjectSettingsChanged ignores events for a different project", async () => {
    let capturedHandler: ((e: { payload: unknown }) => void) | null = null;
    vi.mocked(listen).mockImplementation((event, handler) => {
      if (event === "project:settings:changed") {
        capturedHandler = handler as (e: { payload: unknown }) => void;
      }
      return Promise.resolve(() => {});
    });
    useProjectSettingsStore.setState({
      projectId: "p2", data: null, status: "loaded", dirty: {}, lastError: null,
    });
    renderWithProviders(<Workbench />);
    await waitFor(() => expect(capturedHandler).not.toBeNull());
    capturedHandler!({ payload: { projectId: "p1", settings: { name: "should-be-ignored" } } });
    expect(useProjectSettingsStore.getState().data).toBeNull();
    vi.mocked(listen).mockReset().mockResolvedValue(() => {});
  });
});
