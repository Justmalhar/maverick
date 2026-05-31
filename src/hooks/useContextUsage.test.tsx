import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useContextUsage, recordUsageEstimate } from "./useContextUsage";
import type { ContextUsage } from "@/lib/ipc";

function usage(overrides: Partial<ContextUsage> = {}): ContextUsage {
  return {
    workspaceId: "w1",
    tokensUsed: 100,
    contextWindow: 200000,
    sessionCostEstimate: 0.01,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(usage() as never);
});

describe("recordUsageEstimate", () => {
  it("computes tokens + cost, records them, and broadcasts an update", async () => {
    const recorded = usage({ tokensUsed: 4, sessionCostEstimate: 0.02 });
    vi.mocked(invoke).mockResolvedValueOnce(recorded as never);
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    const result = await recordUsageEstimate(
      "s1",
      [{ content: "abcd" }, { content: "efgh" }], // 1 + 1 = 2 tokens
      "claude"
    );

    expect(invoke).toHaveBeenCalledWith(
      "context_record",
      expect.objectContaining({ sessionId: "s1", tokensUsed: 2 })
    );
    expect(result).toEqual(recorded);
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent<
      ContextUsage & { sessionId?: string }
    >;
    expect(event.type).toBe("maverick:context:updated");
    expect(event.detail.sessionId).toBe("s1");
    expect(event.detail.tokensUsed).toBe(4);
    dispatchSpy.mockRestore();
  });
});

describe("useContextUsage", () => {
  it("returns zeroed usage when no session id is provided", () => {
    const { result } = renderHook(() => useContextUsage(undefined));
    expect(result.current.tokensUsed).toBe(0);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("fetches usage for the session on mount", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(usage({ tokensUsed: 321 }) as never);
    const { result } = renderHook(() => useContextUsage("s1"));
    await waitFor(() => expect(result.current.tokensUsed).toBe(321));
    expect(invoke).toHaveBeenCalledWith("context_usage", { sessionId: "s1" });
  });

  it("refreshes when a context-updated event for the same session fires", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(usage({ tokensUsed: 10 }) as never);
    const { result } = renderHook(() => useContextUsage("s1"));
    await waitFor(() => expect(result.current.tokensUsed).toBe(10));

    vi.mocked(invoke).mockResolvedValueOnce(usage({ tokensUsed: 99 }) as never);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("maverick:context:updated", {
          detail: { ...usage({ tokensUsed: 99 }), sessionId: "s1" },
        })
      );
    });
    await waitFor(() => expect(result.current.tokensUsed).toBe(99));
  });

  it("ignores a context-updated event for a foreign session (no re-fetch)", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(usage({ tokensUsed: 10 }) as never);
    const { result } = renderHook(() => useContextUsage("s1"));
    await waitFor(() => expect(result.current.tokensUsed).toBe(10));
    expect(invoke).toHaveBeenCalledTimes(1); // mount fetch only

    act(() => {
      window.dispatchEvent(
        new CustomEvent("maverick:context:updated", {
          detail: { ...usage({ tokensUsed: 99 }), sessionId: "other-session" },
        })
      );
    });

    // No additional context_usage IPC was issued for the foreign session.
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.current.tokensUsed).toBe(10);
  });

  it("refreshes for an event without a sessionId (wildcard, no over-suppression)", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(usage({ tokensUsed: 10 }) as never);
    const { result } = renderHook(() => useContextUsage("s1"));
    await waitFor(() => expect(result.current.tokensUsed).toBe(10));

    vi.mocked(invoke).mockResolvedValueOnce(usage({ tokensUsed: 77 }) as never);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("maverick:context:updated", { detail: usage({ tokensUsed: 77 }) })
      );
    });
    await waitFor(() => expect(result.current.tokensUsed).toBe(77));
  });

  it("falls back to zeroed usage when the fetch fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("no session"));
    const { result } = renderHook(() => useContextUsage("s1"));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(result.current.tokensUsed).toBe(0);
  });
});
