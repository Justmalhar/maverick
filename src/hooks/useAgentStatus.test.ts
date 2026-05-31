import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  streamRequestsAttention,
  statusForExit,
  useAgentStatusStore,
  useAgentStatus,
  useAgentStatusReporter,
  IDLE_AFTER_MS,
} from "./useAgentStatus";

beforeEach(() => {
  useAgentStatusStore.setState({ statuses: {} });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("streamRequestsAttention", () => {
  it("detects a BEL", () => {
    expect(streamRequestsAttention("hi\x07there")).toBe(true);
  });
  it("detects the iTerm2/macOS attention OSC", () => {
    expect(streamRequestsAttention("\x1b]9;done\x07")).toBe(true);
  });
  it("is false for ordinary output", () => {
    expect(streamRequestsAttention("compiling main.rs")).toBe(false);
  });
});

describe("statusForExit", () => {
  it("maps 0 to done", () => expect(statusForExit(0)).toBe("done"));
  it("maps non-zero to error", () => {
    expect(statusForExit(1)).toBe("error");
    expect(statusForExit(137)).toBe("error");
  });
});

describe("useAgentStatusStore", () => {
  it("sets a status", () => {
    useAgentStatusStore.getState().setStatus("w1", "working");
    expect(useAgentStatusStore.getState().statuses.w1).toBe("working");
  });
  it("is a no-op (stable ref) when the status is unchanged", () => {
    useAgentStatusStore.getState().setStatus("w1", "working");
    const before = useAgentStatusStore.getState().statuses;
    useAgentStatusStore.getState().setStatus("w1", "working");
    expect(useAgentStatusStore.getState().statuses).toBe(before);
  });
  it("clears a tracked status", () => {
    useAgentStatusStore.getState().setStatus("w1", "error");
    useAgentStatusStore.getState().clearStatus("w1");
    expect("w1" in useAgentStatusStore.getState().statuses).toBe(false);
  });
  it("clearStatus is a no-op (stable ref) for an unknown workspace", () => {
    const before = useAgentStatusStore.getState().statuses;
    useAgentStatusStore.getState().clearStatus("nope");
    expect(useAgentStatusStore.getState().statuses).toBe(before);
  });
});

describe("useAgentStatus", () => {
  it("defaults to idle when untracked", () => {
    const { result } = renderHook(() => useAgentStatus("ghost"));
    expect(result.current).toBe("idle");
  });
  it("reflects the store value", () => {
    const { result } = renderHook(() => useAgentStatus("w1"));
    act(() => useAgentStatusStore.getState().setStatus("w1", "done"));
    expect(result.current).toBe("done");
  });
});

describe("useAgentStatusReporter", () => {
  it("flips to working on output then relaxes to idle after the quiet window", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAgentStatusReporter("w1"));
    act(() => result.current.reportOutput("building..."));
    expect(useAgentStatusStore.getState().statuses.w1).toBe("working");
    act(() => vi.advanceTimersByTime(IDLE_AFTER_MS));
    expect(useAgentStatusStore.getState().statuses.w1).toBe("idle");
  });

  it("flips to attention on a BEL/OSC chunk", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAgentStatusReporter("w1"));
    act(() => result.current.reportOutput("\x07"));
    expect(useAgentStatusStore.getState().statuses.w1).toBe("attention");
  });

  it("coalesces rapid output into a single working state (debounced idle)", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAgentStatusReporter("w1"));
    act(() => {
      result.current.reportOutput("a");
      vi.advanceTimersByTime(IDLE_AFTER_MS - 1);
      result.current.reportOutput("b");
      vi.advanceTimersByTime(IDLE_AFTER_MS - 1);
    });
    // Still working — each chunk re-armed the timer, so idle never fired.
    expect(useAgentStatusStore.getState().statuses.w1).toBe("working");
    act(() => vi.advanceTimersByTime(1));
    expect(useAgentStatusStore.getState().statuses.w1).toBe("idle");
  });

  it("markExit(0) records done and cancels the idle timer", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAgentStatusReporter("w1"));
    act(() => result.current.reportOutput("x"));
    act(() => result.current.markExit(0));
    expect(useAgentStatusStore.getState().statuses.w1).toBe("done");
    act(() => vi.advanceTimersByTime(IDLE_AFTER_MS * 2));
    expect(useAgentStatusStore.getState().statuses.w1).toBe("done");
  });

  it("markExit(non-zero) records error", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAgentStatusReporter("w1"));
    act(() => result.current.markExit(1));
    expect(useAgentStatusStore.getState().statuses.w1).toBe("error");
  });

  it("ignores output after exit (no idle revival)", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAgentStatusReporter("w1"));
    act(() => result.current.markExit(0));
    act(() => result.current.reportOutput("late output"));
    expect(useAgentStatusStore.getState().statuses.w1).toBe("done");
  });

  it("clears the pending timer on unmount (no idle set after unmount)", () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useAgentStatusReporter("w1"));
    act(() => result.current.reportOutput("x"));
    expect(useAgentStatusStore.getState().statuses.w1).toBe("working");
    unmount();
    act(() => vi.advanceTimersByTime(IDLE_AFTER_MS * 2));
    // Timer was cleared on unmount, so it stays at the last set value.
    expect(useAgentStatusStore.getState().statuses.w1).toBe("working");
  });
});
