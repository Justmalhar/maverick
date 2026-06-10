import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor, act } from "@/test/utils";
import UsagePanel from "./UsagePanel";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";
import type { BackendTokenUsage, UsageSummary } from "@/lib/ipc";

const initial = useWorkbench.getState();

function usage(backend: string, over: Partial<BackendTokenUsage> = {}): BackendTokenUsage {
  return {
    backend,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    sessions: 0,
    ...over,
  };
}

function summaryOf(backends: BackendTokenUsage[]): UsageSummary {
  return { date: "2026-06-10", backends };
}

function mockSummary(summary: UsageSummary | (() => UsageSummary)) {
  vi.mocked(invoke).mockImplementation(((cmd: string) => {
    if (cmd === "usage_summary") {
      return Promise.resolve(typeof summary === "function" ? summary() : summary);
    }
    return Promise.resolve(undefined);
  }) as unknown as typeof invoke);
}

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined as never);
  useWorkbench.setState({ ...initial, backends: [], workspaces: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("UsagePanel", () => {
  it("renders the Usage panel heading", () => {
    renderWithProviders(<UsagePanel />);
    expect(screen.getByTestId("usage-panel")).toBeInTheDocument();
    expect(screen.getByText("Usage")).toBeInTheDocument();
  });

  it("shows exactly the three tracked backends with brand labels", () => {
    renderWithProviders(<UsagePanel />);
    expect(screen.getByTestId("usage-backends")).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("Antigravity")).toBeInTheDocument();
    expect(screen.queryByText("Gemini CLI")).not.toBeInTheDocument();
    expect(screen.queryByText("gemini")).not.toBeInTheDocument();
  });

  it("never duplicates Claude Code even when the summary repeats or adds backends", async () => {
    mockSummary(
      summaryOf([
        usage("claude-code", { totalTokens: 10 }),
        usage("claude-code", { totalTokens: 99 }),
        usage("gemini", { totalTokens: 5 }),
      ])
    );
    renderWithProviders(<UsagePanel />);
    await waitFor(() => expect(screen.getAllByText("Claude Code")).toHaveLength(1));
    expect(screen.queryByText("claude-code")).not.toBeInTheDocument();
    expect(screen.queryByText("gemini")).not.toBeInTheDocument();
  });

  it("renders a brand icon for each backend row", () => {
    renderWithProviders(<UsagePanel />);
    for (const backend of ["claude-code", "codex", "antigravity"]) {
      expect(screen.getByTestId(`usage-backend-icon-${backend}`)).toBeInTheDocument();
    }
  });

  it("renders all three summary stat cards", () => {
    renderWithProviders(<UsagePanel />);
    expect(screen.getByTestId("usage-stat-tokens-today")).toBeInTheDocument();
    expect(screen.getByTestId("usage-stat-sessions-today")).toBeInTheDocument();
    expect(screen.getByTestId("usage-stat-est-cost")).toBeInTheDocument();
  });

  it("shows $0.00 cost and 0 tokens by default", () => {
    renderWithProviders(<UsagePanel />);
    expect(screen.getByTestId("usage-stat-est-cost")).toHaveTextContent("$0.00");
    expect(screen.getByTestId("usage-stat-tokens-today")).toHaveTextContent("0");
  });

  it("reflects workspace count in the summary card", () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" }), makeWorkspace({ id: "w2" })],
    });
    renderWithProviders(<UsagePanel />);
    expect(screen.getByTestId("usage-stat-tokens-today")).toHaveTextContent("2 active workspaces");
  });

  it("aggregates totals, sessions, and estimated cost across backends", async () => {
    mockSummary(
      summaryOf([
        // 2000 tokens at claude pricing ($0.009/1k) = $0.018
        usage("claude-code", { totalTokens: 2000, sessions: 2 }),
        // 1000 tokens at codex pricing ($0.006/1k) = $0.006
        usage("codex", { totalTokens: 1000, sessions: 1 }),
        usage("antigravity"),
      ])
    );
    renderWithProviders(<UsagePanel />);
    await waitFor(() =>
      expect(screen.getByTestId("usage-stat-tokens-today")).toHaveTextContent("3.0k")
    );
    expect(screen.getByTestId("usage-stat-sessions-today")).toHaveTextContent("3");
    expect(screen.getByTestId("usage-stat-est-cost")).toHaveTextContent("$0.02");
  });

  it("shows the per-backend token breakdown", async () => {
    mockSummary(
      summaryOf([
        usage("claude-code", {
          inputTokens: 1200,
          outputTokens: 400,
          cacheReadTokens: 90000,
          cacheCreationTokens: 10000,
          totalTokens: 101600,
          sessions: 4,
        }),
        usage("codex"),
        usage("antigravity"),
      ])
    );
    renderWithProviders(<UsagePanel />);
    await waitFor(() =>
      expect(screen.getByTestId("usage-backend-claude-code")).toHaveTextContent("101.6k")
    );
    const row = screen.getByTestId("usage-backend-claude-code");
    expect(row).toHaveTextContent("1.2k");
    expect(row).toHaveTextContent("400");
    expect(row).toHaveTextContent("100.0k"); // cache read + creation
    expect(row).toHaveTextContent("4");
  });

  it("refreshes when a context-updated event fires", async () => {
    let total = 100;
    mockSummary(() =>
      summaryOf([
        usage("claude-code", { totalTokens: total }),
        usage("codex"),
        usage("antigravity"),
      ])
    );
    renderWithProviders(<UsagePanel />);
    await waitFor(() =>
      expect(screen.getByTestId("usage-stat-tokens-today")).toHaveTextContent("100")
    );

    total = 5000;
    act(() => window.dispatchEvent(new CustomEvent("maverick:context:updated")));
    await waitFor(() =>
      expect(screen.getByTestId("usage-stat-tokens-today")).toHaveTextContent("5.0k")
    );
  });

  it("polls for fresh figures on an interval", async () => {
    vi.useFakeTimers();
    let total = 100;
    mockSummary(() =>
      summaryOf([
        usage("claude-code", { totalTokens: total }),
        usage("codex"),
        usage("antigravity"),
      ])
    );
    renderWithProviders(<UsagePanel />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("usage-stat-tokens-today")).toHaveTextContent("100");

    total = 7000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByTestId("usage-stat-tokens-today")).toHaveTextContent("7.0k");
  });

  it("keeps last known figures when the summary RPC fails", async () => {
    let fail = false;
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "usage_summary") {
        return fail
          ? Promise.reject(new Error("sidecar down"))
          : Promise.resolve(summaryOf([usage("claude-code", { totalTokens: 1500 }), usage("codex"), usage("antigravity")]));
      }
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);

    renderWithProviders(<UsagePanel />);
    await waitFor(() =>
      expect(screen.getByTestId("usage-stat-tokens-today")).toHaveTextContent("1.5k")
    );

    fail = true;
    act(() => window.dispatchEvent(new CustomEvent("maverick:context:updated")));
    // Still showing the last good figures, not zeros.
    expect(screen.getByTestId("usage-stat-tokens-today")).toHaveTextContent("1.5k");
  });

  it("renders tips section", () => {
    renderWithProviders(<UsagePanel />);
    expect(screen.getByText("Tips")).toBeInTheDocument();
  });
});
