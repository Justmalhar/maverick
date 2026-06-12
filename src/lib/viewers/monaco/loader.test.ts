import { describe, expect, it } from "vitest";
import { getMonaco } from "./loader";

describe("getMonaco", () => {
  it("returns the same instance on repeated calls (singleton)", async () => {
    const a = await getMonaco();
    const b = await getMonaco();
    // Singleton: same resolved object reference between calls
    expect(Object.is(a, b)).toBe(true);
    // The boot() resolves the monaco import which has the same editor spy as __monaco
    const monacoGlobal = (globalThis as Record<string, unknown>).__monaco as Record<string, unknown>;
    expect(Object.is(a.editor, monacoGlobal.editor)).toBe(true);
  });

  it("registers languages and applies the shiki bridge once", async () => {
    const monaco = await getMonaco();
    const { shikiToMonaco } = await import("@shikijs/monaco");
    expect(shikiToMonaco).toHaveBeenCalledTimes(1);
    expect(monaco.languages.register).toHaveBeenCalled();
  });
});

describe("ensureLanguage", () => {
  it("returns the language id without calling loadLanguage for already-loaded grammars", async () => {
    // shiki mock pre-loads typescript — no loadLanguage call needed
    const { ensureLanguage } = await import("./loader");
    const { createHighlighter } = await import("shiki");
    const lang = await ensureLanguage("/src/a.ts");
    expect(lang).toBe("typescript");
    const hlInstance = await (createHighlighter as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(hlInstance.loadLanguage).not.toHaveBeenCalled();
  });

  it("calls loadLanguage for a grammar not yet loaded", async () => {
    const { ensureLanguage } = await import("./loader");
    const { createHighlighter } = await import("shiki");
    const lang = await ensureLanguage("/src/b.rs");
    expect(lang).toBe("rust");
    const hlInstance = await (createHighlighter as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(hlInstance.loadLanguage).toHaveBeenCalledWith("rust");
  });
});
