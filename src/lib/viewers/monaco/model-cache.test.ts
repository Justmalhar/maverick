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
});
