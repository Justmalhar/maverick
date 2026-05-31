import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useResponsiveLayout, COMPACT_BREAKPOINT_PX, __testing__ } from "./useResponsiveLayout";
import { useWorkbench } from "@/state/store";

const initial = useWorkbench.getState();
const realMatchMedia = window.matchMedia;

interface FakeMql {
  matches: boolean;
  media: string;
  listeners: Array<(e: MediaQueryListEvent) => void>;
  addEventListener: (type: string, cb: (e: MediaQueryListEvent) => void) => void;
  removeEventListener: (type: string, cb: (e: MediaQueryListEvent) => void) => void;
}

function installMatchMedia(matches: boolean): { mql: FakeMql; spy: ReturnType<typeof vi.fn> } {
  const mql: FakeMql = {
    matches,
    media: "",
    listeners: [],
    addEventListener: (_type, cb) => mql.listeners.push(cb),
    removeEventListener: (_type, cb) => {
      mql.listeners = mql.listeners.filter((l) => l !== cb);
    },
  };
  const spy = vi.fn(() => mql);
  Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: spy });
  return { mql, spy };
}

beforeEach(() => {
  useWorkbench.setState(initial);
});

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: realMatchMedia,
  });
});

describe("useResponsiveLayout", () => {
  it("exposes the breakpoint constant and media query", () => {
    expect(COMPACT_BREAKPOINT_PX).toBe(900);
    expect(__testing__.MEDIA_QUERY).toContain("900px");
  });

  it("collapses when below the breakpoint", () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useResponsiveLayout());
    expect(result.current.collapsed).toBe(true);
  });

  it("expands at or above the breakpoint", () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useResponsiveLayout());
    expect(result.current.collapsed).toBe(false);
  });

  it("reacts to media-query change events", () => {
    const { mql } = installMatchMedia(true);
    const { result } = renderHook(() => useResponsiveLayout());
    expect(result.current.collapsed).toBe(false);
    act(() => {
      mql.matches = false;
      mql.listeners.forEach((l) => l({ matches: false } as MediaQueryListEvent));
    });
    expect(result.current.collapsed).toBe(true);
  });

  it("toggle manually overrides the current state", () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useResponsiveLayout());
    expect(result.current.collapsed).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(false);
  });

  it("manual override survives a within-range change event", () => {
    const { mql } = installMatchMedia(true);
    const { result } = renderHook(() => useResponsiveLayout());
    expect(result.current.collapsed).toBe(false);
    // User manually collapses while wide.
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    // A change event fires at the same side (still wide) — must not stomp the choice.
    act(() => {
      mql.matches = true;
      mql.listeners.forEach((l) => l({ matches: true } as MediaQueryListEvent));
    });
    expect(result.current.collapsed).toBe(true);
  });

  it("clears the manual override when the breakpoint is crossed", () => {
    const { mql } = installMatchMedia(true);
    const { result } = renderHook(() => useResponsiveLayout());
    // Manually expand-then-collapse path: collapse while wide.
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    // Cross below the breakpoint — query result (collapsed) wins and clears manual.
    act(() => {
      mql.matches = false;
      mql.listeners.forEach((l) => l({ matches: false } as MediaQueryListEvent));
    });
    expect(result.current.collapsed).toBe(true);
    // Cross back above — now expands because the manual override was cleared.
    act(() => {
      mql.matches = true;
      mql.listeners.forEach((l) => l({ matches: true } as MediaQueryListEvent));
    });
    expect(result.current.collapsed).toBe(false);
  });

  it("removes its listener on unmount", () => {
    const { mql } = installMatchMedia(true);
    const { unmount } = renderHook(() => useResponsiveLayout());
    expect(mql.listeners).toHaveLength(1);
    unmount();
    expect(mql.listeners).toHaveLength(0);
  });

  it("no-ops the effect when matchMedia is unavailable", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: undefined,
    });
    useWorkbench.setState({ layout: { ...initial.layout, activitybarCollapsed: true } });
    const { result } = renderHook(() => useResponsiveLayout());
    // Effect bailed out — store value untouched, toggle still works.
    expect(result.current.collapsed).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(false);
  });
});
