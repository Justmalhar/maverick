import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, within, waitFor } from "@/test/utils";
import { DashboardView } from "./DashboardView";
import { useWorkbench } from "@/state/store";
import { useAgentStatusStore } from "@/hooks/useAgentStatus";
import { makeWorkspace, makeProject, makeDiff, makeDiffFile } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  // Cards fetch a diff summary on mount; default to no result (no stats row).
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined as never);
  useWorkbench.setState({
    ...initial,
    projects: [],
    workspaces: [],
    activeWorkspaceId: null,
  });
  useAgentStatusStore.setState({ statuses: {} });
});

describe("DashboardView", () => {
  it("renders the dashboard shell with a workspace count stat", () => {
    renderWithProviders(<DashboardView />);
    expect(screen.getByTestId("dashboard-view")).toBeInTheDocument();
    const ws = screen.getByTestId("dashboard-stat-workspaces");
    expect(ws).toHaveTextContent("Workspaces");
    expect(ws).toHaveTextContent("0");
  });

  it("shows an empty state when there are no workspaces", () => {
    renderWithProviders(<DashboardView />);
    expect(screen.getByTestId("dashboard-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-agent-ws-1")).not.toBeInTheDocument();
  });

  it("renders one agent card per workspace with title, project and branch/backend", () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "proj-1", name: "Polaris" })],
      workspaces: [
        makeWorkspace({ id: "w1", projectId: "proj-1", title: "Fix login", branch: "feat/login", agentBackend: "claude" }),
      ],
    });
    renderWithProviders(<DashboardView />);
    const card = screen.getByTestId("dashboard-agent-w1");
    expect(card).toHaveTextContent("Fix login");
    expect(card).toHaveTextContent("Polaris");
    expect(card).toHaveTextContent("feat/login");
    expect(card).toHaveTextContent("claude");
  });

  it("falls back to the branch as the card title when no title is set", () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", title: undefined, branch: "main" })],
    });
    renderWithProviders(<DashboardView />);
    expect(screen.getByTestId("dashboard-agent-w1")).toHaveTextContent("main");
  });

  it("reflects each workspace's live agent status on its card", () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" }), makeWorkspace({ id: "w2" })],
    });
    useAgentStatusStore.setState({ statuses: { w1: "working", w2: "error" } });
    renderWithProviders(<DashboardView />);
    expect(screen.getByTestId("dashboard-agent-w1")).toHaveAttribute("data-status", "working");
    expect(screen.getByTestId("dashboard-agent-w2")).toHaveAttribute("data-status", "error");
    // Untracked workspaces default to idle.
    expect(
      within(screen.getByTestId("dashboard-agent-w1")).getByTestId("agent-status-pill")
    ).toBeInTheDocument();
  });

  it("counts active agents (working or attention) in the Active stat", () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" }), makeWorkspace({ id: "w2" }), makeWorkspace({ id: "w3" })],
    });
    useAgentStatusStore.setState({ statuses: { w1: "working", w2: "attention", w3: "idle" } });
    renderWithProviders(<DashboardView />);
    expect(screen.getByTestId("dashboard-stat-active")).toHaveTextContent("2");
  });

  it("focuses the workspace when its card is clicked", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" })],
      activeWorkspaceId: null,
    });
    renderWithProviders(<DashboardView />);
    await userEvent.click(screen.getByTestId("dashboard-agent-w1"));
    expect(useWorkbench.getState().activeWorkspaceId).toBe("w1");
  });

  it("shows the worktree diff summary (files + adds/dels) on a card", async () => {
    vi.mocked(invoke).mockResolvedValue(
      makeDiff({
        files: [
          makeDiffFile({ path: "src/a.ts", additions: 7, deletions: 2 }),
          makeDiffFile({ path: "src/b.ts", additions: 3, deletions: 1 }),
        ],
      }) as never
    );
    useWorkbench.setState({ ...initial, workspaces: [makeWorkspace({ id: "w1" })] });
    renderWithProviders(<DashboardView />);
    const stats = await screen.findByTestId("dashboard-agent-stats-w1");
    expect(stats).toHaveTextContent("2 files");
    expect(stats).toHaveTextContent("+10");
    expect(stats).toHaveTextContent("3");
    expect(invoke).toHaveBeenCalledWith(
      "diff_get",
      expect.objectContaining({ worktreePath: "/tmp/demo/.maverick/worktrees/ws-1" })
    );
  });

  it("shows a singular file label for a single changed file", async () => {
    vi.mocked(invoke).mockResolvedValue(
      makeDiff({ files: [makeDiffFile({ additions: 1, deletions: 0 })] }) as never
    );
    useWorkbench.setState({ ...initial, workspaces: [makeWorkspace({ id: "w1" })] });
    renderWithProviders(<DashboardView />);
    expect(await screen.findByTestId("dashboard-agent-stats-w1")).toHaveTextContent("1 file");
  });

  it("omits the diff summary when the worktree is clean", async () => {
    vi.mocked(invoke).mockResolvedValue(makeDiff({ files: [] }) as never);
    useWorkbench.setState({ ...initial, workspaces: [makeWorkspace({ id: "w1" })] });
    renderWithProviders(<DashboardView />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("diff_get", expect.anything()));
    expect(screen.queryByTestId("dashboard-agent-stats-w1")).not.toBeInTheDocument();
  });

  it("opens the workspace's changes (focus + source control) from the card", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" })],
      activeWorkspaceId: null,
    });
    renderWithProviders(<DashboardView />);
    await userEvent.click(screen.getByTestId("dashboard-agent-open-changes-w1"));
    const s = useWorkbench.getState();
    expect(s.activeWorkspaceId).toBe("w1");
    expect(s.layout.auxiliaryView).toBe("scm");
    expect(s.layout.auxiliaryBarVisible).toBe(true);
  });

  it("marks the active workspace's card", () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" }), makeWorkspace({ id: "w2" })],
      activeWorkspaceId: "w2",
    });
    renderWithProviders(<DashboardView />);
    expect(screen.getByTestId("dashboard-agent-w1")).toHaveAttribute("data-active", "false");
    expect(screen.getByTestId("dashboard-agent-w2")).toHaveAttribute("data-active", "true");
  });

  it("silently clears stats when diff_get throws (catch branch, line 102)", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("diff-unavailable"));
    useWorkbench.setState({ ...initial, workspaces: [makeWorkspace({ id: "w1" })] });
    renderWithProviders(<DashboardView />);
    // After the rejection resolves, the card must still render with no stats row.
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("diff_get", expect.anything()));
    expect(screen.queryByTestId("dashboard-agent-stats-w1")).not.toBeInTheDocument();
  });
});
