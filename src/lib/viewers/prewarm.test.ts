import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as loader from "./monaco/loader";
import { prewarmEditor, __resetPrewarm } from "./prewarm";

describe("prewarmEditor", () => {
  beforeEach(() => {
    __resetPrewarm();
    vi.spyOn(loader, "getMonaco").mockResolvedValue(
      {} as unknown as Awaited<ReturnType<typeof loader.getMonaco>>
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
  });

  it("boots Monaco via requestIdleCallback when available", () => {
    const ric = vi.fn((cb: () => void) => cb());
    (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback = ric;
    prewarmEditor();
    expect(ric).toHaveBeenCalledOnce();
    expect(loader.getMonaco).toHaveBeenCalledOnce();
  });

  it("falls back to setTimeout when requestIdleCallback is absent", () => {
    delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
    vi.useFakeTimers();
    try {
      prewarmEditor();
      expect(loader.getMonaco).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(loader.getMonaco).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("is idempotent — a second call does not warm again", () => {
    const ric = vi.fn((cb: () => void) => cb());
    (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback = ric;
    prewarmEditor();
    prewarmEditor();
    expect(ric).toHaveBeenCalledOnce();
  });
});
