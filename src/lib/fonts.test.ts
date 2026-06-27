import { afterEach, describe, expect, it, vi } from "vitest";
import { monoFontFamily } from "./fonts";

describe("monoFontFamily", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty("--font-mono");
  });

  it("returns the resolved --font-mono token when set", () => {
    document.documentElement.style.setProperty("--font-mono", '"Geist Mono", monospace');
    expect(monoFontFamily()).toBe('"Geist Mono", monospace');
  });

  it("falls back to the built-in stack when the token is empty", () => {
    document.documentElement.style.setProperty("--font-mono", "");
    expect(monoFontFamily()).toContain("Geist Mono");
    expect(monoFontFamily()).toContain("monospace");
  });

  it("falls back when document is unavailable (SSR/worker)", () => {
    vi.stubGlobal("document", undefined);
    expect(monoFontFamily()).toContain("monospace");
  });
});
