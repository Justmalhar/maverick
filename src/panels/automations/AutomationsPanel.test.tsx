import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { act } from "@testing-library/react";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import AutomationsPanel from "./AutomationsPanel";
import { useWorkbench } from "@/state/store";
import { makeAutomation, makeProject, makeWorkspace } from "@/test/fixtures";

const lastConfigSave = () => {
  const saves = vi.mocked(invoke).mock.calls.filter((c) => c[0] === "config_save");
  return saves.length
    ? (saves[saves.length - 1][1] as { patch: { automations: { name: string }[] } }).patch
    : null;
};

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState({ ...initial, projects: [], workspaces: [], activeWorkspaceId: null });
});

describe("AutomationsPanel", () => {
  it("shows empty list when no project loaded", async () => {
    renderWithProviders(<AutomationsPanel />);
    expect(screen.getByTestId("automations-panel")).toBeInTheDocument();
  });

  it("loads automations from config, selects one, then creates new", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", path: "/p" })],
      workspaces: [makeWorkspace({ id: "w1", projectId: "p1" })],
      activeWorkspaceId: "w1",
    });
    vi.mocked(invoke).mockResolvedValueOnce({
      version: 1, backends: { default: "x", available: [] },
      automations: [makeAutomation({ name: "build" })],
    } as never);
    renderWithProviders(<AutomationsPanel />);
    await waitFor(() => expect(screen.getByText("build")).toBeInTheDocument());
    await userEvent.click(screen.getAllByTestId("automation-item")[0]);
    expect(screen.getByTestId("automation-builder")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("automation-new"));
  });

  it("run button invokes automation_run and handles errors", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", path: "/p" })],
      workspaces: [makeWorkspace({ id: "w1", projectId: "p1" })],
      activeWorkspaceId: "w1",
    });
    vi.mocked(invoke).mockResolvedValueOnce({
      version: 1, backends: { default: "x", available: [] },
      automations: [makeAutomation({ name: "build" })],
    } as never).mockResolvedValueOnce(undefined as never);
    renderWithProviders(<AutomationsPanel />);
    await userEvent.click(await screen.findByTestId("automation-run"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("automation_run", { automationName: "build", workspaceId: "w1" }));

    vi.mocked(invoke).mockResolvedValueOnce({
      version: 1, backends: { default: "x", available: [] },
      automations: [makeAutomation({ name: "build" })],
    } as never).mockRejectedValueOnce(new Error("runfail"));
    renderWithProviders(<AutomationsPanel />);
    await userEvent.click((await screen.findAllByTestId("automation-run"))[0]);
    await waitFor(() => expect(screen.getAllByText(/runfail/)[0]).toBeInTheDocument());
  });

  it("captures config errors", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", path: "/p" })],
      workspaces: [makeWorkspace({ id: "w1", projectId: "p1" })],
      activeWorkspaceId: "w1",
    });
    vi.mocked(invoke).mockRejectedValueOnce(new Error("cfg"));
    renderWithProviders(<AutomationsPanel />);
    await waitFor(() => expect(screen.getByText(/cfg/)).toBeInTheDocument());
  });

  it("upsert keeps existing entries when index matches (edit selected) and persists via config_save", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", path: "/p" })],
      workspaces: [makeWorkspace({ id: "w1", projectId: "p1" })],
      activeWorkspaceId: "w1",
    });
    vi.mocked(invoke).mockResolvedValueOnce({
      version: 1, backends: { default: "x", available: [] },
      automations: [makeAutomation({ name: "old", steps: [] })],
    } as never).mockResolvedValue({ version: 1, backends: { default: "x", available: [] } } as never);
    renderWithProviders(<AutomationsPanel />);
    await userEvent.click(await screen.findByTestId("automation-item"));
    await userEvent.click(screen.getByTestId("automation-add-step"));
    await userEvent.click(screen.getByText("shell"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "config_save",
        expect.objectContaining({ projectPath: "/p" })
      )
    );
  });

  it("persists a brand-new automation through config_save", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", path: "/p" })],
      workspaces: [makeWorkspace({ id: "w1", projectId: "p1" })],
      activeWorkspaceId: "w1",
    });
    vi.mocked(invoke).mockResolvedValue({
      version: 1, backends: { default: "x", available: [] },
      automations: [],
    } as never);
    renderWithProviders(<AutomationsPanel />);
    // Let the initial config_load settle so upsert's closure carries activeProject.
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("config_load", { projectPath: "/p" }));
    await userEvent.click(screen.getByTestId("automation-new"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("config_save", expect.anything()));
  });

  it("surfaces a config_save failure", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", path: "/p" })],
      workspaces: [makeWorkspace({ id: "w1", projectId: "p1" })],
      activeWorkspaceId: "w1",
    });
    vi.mocked(invoke)
      .mockResolvedValueOnce({
        version: 1, backends: { default: "x", available: [] },
        automations: [],
      } as never)
      .mockRejectedValue(new Error("savefail"));
    renderWithProviders(<AutomationsPanel />);
    await waitFor(() => expect(screen.getByTestId("automations-panel")).toBeInTheDocument());
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("config_load", { projectPath: "/p" }));
    await userEvent.click(screen.getByTestId("automation-new"));
    await waitFor(() => expect(screen.getByText(/savefail/)).toBeInTheDocument());
  });

  it("renames an automation in place instead of appending a duplicate", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", path: "/p" })],
      workspaces: [makeWorkspace({ id: "w1", projectId: "p1" })],
      activeWorkspaceId: "w1",
    });
    vi.mocked(invoke)
      .mockResolvedValueOnce({
        version: 1, backends: { default: "x", available: [] },
        automations: [makeAutomation({ name: "old", steps: [] })],
      } as never)
      .mockResolvedValue({ version: 1, backends: { default: "x", available: [] } } as never);
    renderWithProviders(<AutomationsPanel />);
    await userEvent.click(await screen.findByTestId("automation-item"));
    await userEvent.type(screen.getByTestId("automation-name"), "X");
    // The rename must replace the original row, never grow the list.
    await waitFor(() => expect(lastConfigSave()?.automations).toHaveLength(1));
    expect(lastConfigSave()?.automations[0].name).toMatch(/^old/);
  });

  it("New picks a non-colliding name when length+1 already exists", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", path: "/p" })],
      workspaces: [makeWorkspace({ id: "w1", projectId: "p1" })],
      activeWorkspaceId: "w1",
    });
    vi.mocked(invoke)
      .mockResolvedValueOnce({
        version: 1, backends: { default: "x", available: [] },
        automations: [makeAutomation({ name: "new-automation-2" })],
      } as never)
      .mockResolvedValue({ version: 1, backends: { default: "x", available: [] } } as never);
    renderWithProviders(<AutomationsPanel />);
    await waitFor(() => expect(screen.getByText("new-automation-2")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("automation-new"));
    await waitFor(() => {
      const saved = lastConfigSave();
      expect(saved?.automations).toHaveLength(2);
      expect(saved?.automations.some((a) => a.name === "new-automation-3")).toBe(true);
      expect(saved?.automations.filter((a) => a.name === "new-automation-2")).toHaveLength(1);
    });
  });

  it("runner shows steps for the RUNNING automation even when another is selected", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", path: "/p" })],
      workspaces: [makeWorkspace({ id: "w1", projectId: "p1" })],
      activeWorkspaceId: "w1",
    });
    const handlers: Record<string, (e: { payload: unknown }) => void> = {};
    vi.mocked(listen).mockImplementation((evt: string, cb: unknown) => {
      handlers[evt] = cb as never;
      return Promise.resolve(() => {});
    });
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "config_load")
        return Promise.resolve({
          version: 1, backends: { default: "x", available: [] },
          automations: [makeAutomation({ name: "build" }), makeAutomation({ name: "deploy" })],
        }) as never;
      if (cmd === "automation_run") return new Promise(() => {}) as never; // never resolves → stays running
      return Promise.resolve({ version: 1, backends: { default: "x", available: [] } }) as never;
    });
    renderWithProviders(<AutomationsPanel />);
    // Select "deploy" (the second item) but run "build" (the first).
    await waitFor(() => expect(screen.getAllByTestId("automation-item")).toHaveLength(2));
    await userEvent.click(screen.getAllByTestId("automation-item")[1]);
    await userEvent.click(screen.getAllByTestId("automation-run")[0]);
    act(() =>
      handlers["automation:step"]?.({ payload: { automation: "build", stepIndex: 0, status: "running" } })
    );
    // Old code filtered by the SELECTED automation ("deploy") and dropped this event.
    expect(await screen.findByTestId("runner-event")).toBeInTheDocument();
  });
});
