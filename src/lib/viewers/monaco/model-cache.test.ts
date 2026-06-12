import { beforeEach, describe, expect, it } from "vitest";
import { getOrCreateModel, releaseModel, __resetModelCache } from "./model-cache";

describe("model cache", () => {
  beforeEach(() => __resetModelCache());

  it("creates one model per path and reuses it", async () => {
    const a = await getOrCreateModel("/wt/a.ts", "x");
    const b = await getOrCreateModel("/wt/a.ts", "ignored — model exists");
    expect(Object.is(a, b)).toBe(true);
    expect(a.getValue()).toBe("x");
  });

  it("releaseModel disposes when the last holder releases", async () => {
    const m = await getOrCreateModel("/wt/a.ts", "x");
    await getOrCreateModel("/wt/a.ts", "x"); // second holder
    releaseModel("/wt/a.ts");
    expect(m.dispose).not.toHaveBeenCalled();
    releaseModel("/wt/a.ts");
    expect(m.dispose).toHaveBeenCalled();
  });

  it("two concurrent calls return the same model, createModel called once, disposal requires two releases", async () => {
    const monacoGlobal = (globalThis as Record<string, unknown>).__monaco as {
      editor: { createModel: ReturnType<typeof vi.fn> };
    };
    monacoGlobal.editor.createModel.mockClear();

    const [a, b] = await Promise.all([
      getOrCreateModel("/wt/concurrent.ts", "content"),
      getOrCreateModel("/wt/concurrent.ts", "content"),
    ]);

    // Both callers must receive the same model object.
    expect(Object.is(a, b)).toBe(true);

    // createModel must have been invoked exactly once despite two concurrent callers.
    expect(monacoGlobal.editor.createModel).toHaveBeenCalledTimes(1);

    // Two callers → refs === 2; one release is not enough to dispose.
    releaseModel("/wt/concurrent.ts");
    expect(a.dispose).not.toHaveBeenCalled();

    // Second release → refs === 0; model must be disposed.
    releaseModel("/wt/concurrent.ts");
    expect(a.dispose).toHaveBeenCalled();
  });
});
