import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { StatusBar } from "./StatusBar";
import { useWorkbench } from "@/state/store";
import { useAgentStatusStore } from "@/hooks/useAgentStatus";
import { makeWorkspace, makeBackend } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue({
    workspaceId: "",
    tokensUsed: 0,
    contextWindow: 200000,
    sessionCostEstimate: 0,
  } as never);
  useWorkbench.setState({ ...initial, workspaces: [], backends: [], activeWorkspaceId: null });
  useAgentStatusStore.setState({ statuses: {} });
});

describe("StatusBar", () => {
  it("renders nothing but the shell when there is no active workspace", () => {
    renderWithProviders(<StatusBar />);
    expect(screen.getByTestId("statusbar")).toBeInTheDocument();
    expect(screen.queryByTitle(/Branch/)).not.toBeInTheDocument();
  });

  it("shows the active workspace branch and backend", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", branch: "feature/x" })],
      backends: [makeBackend({ id: "claude", active: true })],
      activeWorkspaceId: "w1",
    });
    renderWithProviders(<StatusBar />);
    await waitFor(() => expect(screen.getByTitle("Branch: feature/x")).toBeInTheDocument());
    expect(screen.getByTitle("Backend: claude")).toBeInTheDocument();
  });

  it("shows token usage and cost once context usage loads", async () => {
    vi.mocked(invoke).mockImplementation((cmd) =>
      cmd === "context_usage"
        ? Promise.resolve({
            workspaceId: "w1",
            tokensUsed: 42000,
            contextWindow: 200000,
            sessionCostEstimate: 1.5,
          })
        : Promise.resolve(undefined)
    );
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1", sessionId: "sess-1" })],
      activeWorkspaceId: "w1",
    });
    renderWithProviders(<StatusBar />);
    await waitFor(() => expect(screen.getByTitle("Tokens: 42k / 200k")).toBeInTheDocument());
    expect(screen.getByTitle("Cost: $1.50")).toBeInTheDocument();
  });

  it("shows agent status with the working style", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" })],
      activeWorkspaceId: "w1",
    });
    useAgentStatusStore.setState({ statuses: { w1: "working" } });
    renderWithProviders(<StatusBar />);
    const status = await screen.findByTitle("Status: working");
    expect(status).toHaveClass("text-brand");
    expect(status).toHaveClass("animate-pulse");
  });
});
