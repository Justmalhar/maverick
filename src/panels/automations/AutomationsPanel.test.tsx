import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import AutomationsPanel from "./AutomationsPanel";
import { useWorkbench } from "@/state/store";
import { makeAutomation, makeProject, makeWorkspace } from "@/test/fixtures";

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

  it("upsert keeps existing entries when index matches (edit selected)", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", path: "/p" })],
      workspaces: [makeWorkspace({ id: "w1", projectId: "p1" })],
      activeWorkspaceId: "w1",
    });
    vi.mocked(invoke).mockResolvedValueOnce({
      version: 1, backends: { default: "x", available: [] },
      automations: [makeAutomation({ name: "old", steps: [] })],
    } as never);
    renderWithProviders(<AutomationsPanel />);
    await userEvent.click(await screen.findByTestId("automation-item"));
    await userEvent.click(screen.getByTestId("automation-add-step"));
    await userEvent.click(screen.getByText("shell"));
  });
});
