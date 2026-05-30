import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor, act } from "@/test/utils";
import UsagePanel from "./UsagePanel";
import { useWorkbench } from "@/state/store";
import { makeBackend, makeWorkspace } from "@/test/fixtures";
import type { ContextUsage } from "@/lib/ipc";

const initial = useWorkbench.getState();

function usageFor(tokens: number, cost: number): ContextUsage {
  return { workspaceId: "", tokensUsed: tokens, contextWindow: 200000, sessionCostEstimate: cost };
}

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined as never);
  useWorkbench.setState({ ...initial, backends: [], workspaces: [] });
});

describe("UsagePanel", () => {
  it("renders the Usage panel heading", () => {
    renderWithProviders(<UsagePanel />);
    expect(screen.getByTestId("usage-panel")).toBeInTheDocument();
    expect(screen.getByText("Usage")).toBeInTheDocument();
  });

  it("shows fallback backend rows when no backends are configured", () => {
    renderWithProviders(<UsagePanel />);
    expect(screen.getByTestId("usage-backends")).toBeInTheDocument();
    expect(screen.getByText("claude-code")).toBeInTheDocument();
    expect(screen.getByText("codex")).toBeInTheDocument();
    expect(screen.getByText("gemini")).toBeInTheDocument();
  });

  it("shows real backend rows when backends are configured", () => {
    useWorkbench.setState({
      ...initial,
      backends: [
        makeBackend({ id: "my-backend", name: "my-backend" }),
        makeBackend({ id: "other", name: "other-agent" }),
      ],
    });
    renderWithProviders(<UsagePanel />);
    expect(screen.getByText("my-backend")).toBeInTheDocument();
    expect(screen.getByText("other-agent")).toBeInTheDocument();
    expect(screen.queryByText("claude-code")).not.toBeInTheDocument();
  });

  it("reflects workspace count in the summary card", () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" }), makeWorkspace({ id: "w2" })],
    });
    renderWithProviders(<UsagePanel />);
    expect(screen.getByTestId("usage-stat-tokens-today")).toHaveTextContent("2 active workspaces");
  });

  it("renders all three summary stat cards", () => {
    renderWithProviders(<UsagePanel />);
    expect(screen.getByTestId("usage-stat-tokens-today")).toBeInTheDocument();
    expect(screen.getByTestId("usage-stat-requests")).toBeInTheDocument();
    expect(screen.getByTestId("usage-stat-session-cost")).toBeInTheDocument();
  });

  it("shows $0.00 session cost and 0 tokens by default", () => {
    renderWithProviders(<UsagePanel />);
    expect(screen.getByTestId("usage-stat-session-cost")).toHaveTextContent("$0.00");
    expect(screen.getByTestId("usage-stat-tokens-today")).toHaveTextContent("0");
  });

  it("renders tips section", () => {
    renderWithProviders(<UsagePanel />);
    expect(screen.getByText("Tips")).toBeInTheDocument();
  });

  it("aggregates real session usage per backend", async () => {
    useWorkbench.setState({
      ...initial,
      backends: [makeBackend({ id: "claude", name: "claude" })],
      workspaces: [
        makeWorkspace({ id: "w1", sessionId: "s1", agentBackend: "claude" }),
        makeWorkspace({ id: "w2", sessionId: "s2", agentBackend: "claude" }),
      ],
    });
    vi.mocked(invoke).mockImplementation(((cmd: string, args: { sessionId: string }) => {
      if (cmd === "context_usage") {
        return Promise.resolve(args.sessionId === "s1" ? usageFor(1200, 0.05) : usageFor(800, 0.03));
      }
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);

    renderWithProviders(<UsagePanel />);
    // 1200 + 800 = 2000 tokens → "2.0k"; cost 0.08
    await waitFor(() =>
      expect(screen.getByTestId("usage-stat-tokens-today")).toHaveTextContent("2.0k")
    );
    expect(screen.getByTestId("usage-stat-session-cost")).toHaveTextContent("$0.08");
  });

  it("surfaces a backend that has usage even if it is not configured", async () => {
    useWorkbench.setState({
      ...initial,
      backends: [makeBackend({ id: "claude", name: "claude" })],
      workspaces: [makeWorkspace({ id: "w1", sessionId: "s1", agentBackend: "gemini" })],
    });
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "context_usage") return Promise.resolve(usageFor(500, 0.01));
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);

    renderWithProviders(<UsagePanel />);
    // 'gemini' isn't in the configured backend list but has usage → surfaced.
    await waitFor(() => expect(screen.getByText("gemini")).toBeInTheDocument());
    expect(screen.getByText("claude")).toBeInTheDocument();
  });

  it("refreshes aggregates when a context-updated event fires", async () => {
    useWorkbench.setState({
      ...initial,
      backends: [makeBackend({ id: "claude", name: "claude" })],
      workspaces: [makeWorkspace({ id: "w1", sessionId: "s1", agentBackend: "claude" })],
    });
    let tokens = 100;
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "context_usage") return Promise.resolve(usageFor(tokens, 0));
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);

    renderWithProviders(<UsagePanel />);
    await waitFor(() => expect(screen.getByTestId("usage-stat-tokens-today")).toHaveTextContent("100"));

    tokens = 5000;
    act(() => window.dispatchEvent(new CustomEvent("maverick:context:updated")));
    await waitFor(() => expect(screen.getByTestId("usage-stat-tokens-today")).toHaveTextContent("5.0k"));
  });
});
