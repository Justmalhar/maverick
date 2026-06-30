import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getOrCreateModel,
  releaseModel,
  disposeModelForPath,
  __resetModelCache,
} from "./model-cache";
import * as loader from "./loader";

// Use unique paths per test so models from different tests don't share the
// same Monaco mock URI→model entry (and its dispose spy call count).
let counter = 0;
function freshPath() {
  return `/wt/test-${counter++}.ts`;
}

describe("model cache", () => {
  beforeEach(() => __resetModelCache());

  it("creates one model per path and reuses it", async () => {
    const path = freshPath();
    const a = await getOrCreateModel(path, "x");
    const b = await getOrCreateModel(path, "ignored — model exists");
    expect(Object.is(a, b)).toBe(true);
    expect(a.getValue()).toBe("x");
  });

  it("releaseModel decrements refs but RETAINS the model (does not dispose)", async () => {
    const path = freshPath();
    const m = await getOrCreateModel(path, "x");
    await getOrCreateModel(path, "x"); // second holder → refs === 2
    vi.mocked(m.dispose).mockClear();
    releaseModel(path); // refs → 1
    expect(m.dispose).not.toHaveBeenCalled();
    releaseModel(path); // refs → 0 — model RETAINED, NOT disposed
    expect(m.dispose).not.toHaveBeenCalled();
  });

  it("disposeModelForPath disposes and evicts when refs === 0", async () => {
    const path = freshPath();
    const m = await getOrCreateModel(path, "x");
    vi.mocked(m.dispose).mockClear();
    releaseModel(path); // refs → 0
    disposeModelForPath(path);
    // Model must have been disposed exactly once.
    expect(m.dispose).toHaveBeenCalledOnce();
    // Cache entry is evicted. A new getOrCreateModel re-acquires (refs → 1).
    // Note: in the mock environment monaco.editor.getModel() still returns the
    // same model instance (mock doesn't null it on dispose); what matters is that
    // our cache was cleared and refs restart from 1.
    await getOrCreateModel(path, "x"); // re-acquire → refs 1
    // If the cache were NOT evicted, refs would be at 1 from the prior state
    // and this second getOrCreateModel would make it 2. With eviction, it's 1.
    // Verify by releasing once — a second disposeModelForPath should now dispose again
    // (since refs=1→0→disposeModelForPath can proceed).
    releaseModel(path); // refs → 0
    // dispose count should now be 2 (once from disposeModelForPath above, once more here).
    disposeModelForPath(path);
    expect(m.dispose).toHaveBeenCalledTimes(2);
  });

  it("disposeModelForPath is a no-op when refs > 0 (another viewer holds the ref)", async () => {
    const path = freshPath();
    const m = await getOrCreateModel(path, "x");
    await getOrCreateModel(path, "x"); // refs === 2
    vi.mocked(m.dispose).mockClear();
    releaseModel(path); // refs → 1 (one viewer still active)
    disposeModelForPath(path); // must not dispose
    expect(m.dispose).not.toHaveBeenCalled();
  });

  it("disposeModelForPath is a no-op when no entry exists (non-text file)", () => {
    // No model was ever acquired for this path — should not throw.
    expect(() => disposeModelForPath("/wt/image.png")).not.toThrow();
  });

  it("mode-switch: acquire → release (refs 0) → acquire again returns the SAME model (edits survive)", async () => {
    // This is the Diff⟷Edit switch scenario. FileTabPane stays mounted so
    // disposeModelForPath never runs. The viewer swap does releaseModel then
    // the next viewer does getOrCreateModel — must get the same instance.
    const path = freshPath();
    const first = await getOrCreateModel(path, "original content");
    expect(first.getValue()).toBe("original content");
    releaseModel(path); // viewer unmounts, refs → 0
    const second = await getOrCreateModel(path, "will be ignored — cache hit");
    expect(Object.is(first, second)).toBe(true);
    // Value must still be the original (cache hit, content arg ignored).
    expect(second.getValue()).toBe("original content");
  });

  it("Fix B — creates the model synchronously without awaiting grammar load", async () => {
    // ensureLanguage hangs forever. If getOrCreateModel awaited it (the old
    // behavior), this would never resolve. It must resolve immediately with the
    // model created using the synchronous language id.
    const ensureSpy = vi
      .spyOn(loader, "ensureLanguage")
      .mockReturnValue(new Promise<string>(() => {}));
    try {
      const path = "/wt/fixb.rs";
      const model = await getOrCreateModel(path, "fn main() {}");
      expect(model.getValue()).toBe("fn main() {}");
      // Synchronous id from the extension, not "plaintext" or a resolved grammar.
      expect(model.getLanguageId()).toBe("rust");
      // Grammar load was kicked off fire-and-forget (not awaited).
      expect(ensureSpy).toHaveBeenCalledWith(path);
    } finally {
      ensureSpy.mockRestore();
    }
  });

  it("two concurrent calls return the same model, createModel called once, disposal requires two releases then disposeModelForPath", async () => {
    const monacoGlobal = (globalThis as Record<string, unknown>).__monaco as {
      editor: { createModel: ReturnType<typeof vi.fn> };
    };
    monacoGlobal.editor.createModel.mockClear();

    const path = freshPath();
    const [a, b] = await Promise.all([
      getOrCreateModel(path, "content"),
      getOrCreateModel(path, "content"),
    ]);

    // Both callers must receive the same model object.
    expect(Object.is(a, b)).toBe(true);

    // createModel must have been invoked exactly once despite two concurrent callers.
    expect(monacoGlobal.editor.createModel).toHaveBeenCalledTimes(1);

    vi.mocked(a.dispose).mockClear();

    // Two callers → refs === 2; one release is not enough.
    releaseModel(path);
    expect(a.dispose).not.toHaveBeenCalled();

    // Second release → refs === 0; model is RETAINED (not disposed yet).
    releaseModel(path);
    expect(a.dispose).not.toHaveBeenCalled();

    // Tab close — disposeModelForPath actually frees the model.
    disposeModelForPath(path);
    expect(a.dispose).toHaveBeenCalledOnce();
  });
});
