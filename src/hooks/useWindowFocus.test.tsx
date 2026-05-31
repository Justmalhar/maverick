import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

type FocusCb = (e: { payload: boolean }) => void;

let focusCb: FocusCb | undefined;
let unlistenFocus: ReturnType<typeof vi.fn>;
let onFocusChanged: ReturnType<typeof vi.fn>;

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: (cb: FocusCb) => onFocusChanged(cb),
  }),
}));

import { useWindowFocus, initialFocus, initialVisible } from "./useWindowFocus";

beforeEach(() => {
  focusCb = undefined;
  unlistenFocus = vi.fn();
  onFocusChanged = vi.fn(async (cb: FocusCb) => {
    focusCb = cb;
    return unlistenFocus;
  });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
});

describe("useWindowFocus", () => {
  it("seeds from document.hasFocus / visibilityState", () => {
    const { result } = renderHook(() => useWindowFocus());
    expect(result.current.focused).toBe(true);
    expect(result.current.visible).toBe(true);
  });

  it("updates focus from Tauri onFocusChanged events", async () => {
    const { result } = renderHook(() => useWindowFocus());
    await waitFor(() => expect(focusCb).toBeTypeOf("function"));

    act(() => focusCb?.({ payload: false }));
    expect(result.current.focused).toBe(false);

    act(() => focusCb?.({ payload: true }));
    expect(result.current.focused).toBe(true);
  });

  it("updates visibility from the Page Visibility API", async () => {
    const { result } = renderHook(() => useWindowFocus());
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current.visible).toBe(false);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current.visible).toBe(true);
  });

  it("unsubscribes from focus + visibility on unmount", async () => {
    const { unmount } = renderHook(() => useWindowFocus());
    await waitFor(() => expect(onFocusChanged).toHaveBeenCalled());
    const removeSpy = vi.spyOn(document, "removeEventListener");
    unmount();
    expect(unlistenFocus).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });

  it("calls the unlisten immediately when the listener resolves after unmount", async () => {
    let resolveListen!: (u: () => void) => void;
    onFocusChanged = vi.fn(
      () => new Promise<() => void>((res) => { resolveListen = res; })
    );
    const { unmount } = renderHook(() => useWindowFocus());
    unmount();
    const lateUnlisten = vi.fn();
    await act(async () => {
      resolveListen(lateUnlisten);
      await Promise.resolve();
    });
    expect(lateUnlisten).toHaveBeenCalled();
  });

  it("swallows a rejected onFocusChanged subscription", async () => {
    onFocusChanged = vi.fn(() => Promise.reject(new Error("no window")));
    const { result } = renderHook(() => useWindowFocus());
    await Promise.resolve();
    expect(result.current.focused).toBe(true);
  });

  it("seeds focused from document.hasFocus() in a DOM env", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    expect(initialFocus()).toBe(false);
  });

  it("seeds visible from document.visibilityState in a DOM env", () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    expect(initialVisible()).toBe(false);
  });

  it("initial helpers fall back to true when document is undefined (SSR guard)", () => {
    const original = globalThis.document;
    // @ts-expect-error simulate a non-DOM environment for the initial-state guard
    delete globalThis.document;
    try {
      expect(initialFocus()).toBe(true);
      expect(initialVisible()).toBe(true);
    } finally {
      globalThis.document = original;
    }
  });
});
