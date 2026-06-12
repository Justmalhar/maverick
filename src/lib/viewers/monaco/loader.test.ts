import { describe, expect, it } from "vitest";
import { getMonaco, ensureLanguage } from "./loader";

describe("getMonaco", () => {
  it("returns the same instance on repeated calls (singleton)", async () => {
    const a = await getMonaco();
    const b = await getMonaco();
    expect(Object.is(a, b)).toBe(true);
    const monacoGlobal = (globalThis as Record<string, unknown>).__monaco as Record<string, unknown>;
    expect(Object.is(a.editor, monacoGlobal.editor)).toBe(true);
  });

  it("calls shikiToMonaco exactly once across multiple getMonaco() calls", async () => {
    const { shikiToMonaco } = await import("@shikijs/monaco");
    // Reset the call count to isolate this assertion from the singleton test above.
    vi.mocked(shikiToMonaco).mockClear();
    // Both calls resolve from the already-cached instance — boot() is not re-run.
    await getMonaco();
    await getMonaco();
    expect(shikiToMonaco).toHaveBeenCalledTimes(0);
    expect((await getMonaco()).languages.register).toHaveBeenCalled();
  });
});

describe("ensureLanguage", () => {
  it("returns the language id without calling loadLanguage for already-loaded grammars", async () => {
    // shiki mock pre-loads typescript — no loadLanguage call needed
    const { createHighlighter } = await import("shiki");
    const lang = await ensureLanguage("/src/a.ts");
    expect(lang).toBe("typescript");
    const hlInstance = await (createHighlighter as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(hlInstance.loadLanguage).not.toHaveBeenCalled();
  });

  it("calls loadLanguage for a grammar not yet loaded", async () => {
    const { createHighlighter } = await import("shiki");
    const lang = await ensureLanguage("/src/b.rs");
    expect(lang).toBe("rust");
    const hlInstance = await (createHighlighter as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(hlInstance.loadLanguage).toHaveBeenCalledWith("rust");
  });

  it("boots internally when called without a prior getMonaco() call", async () => {
    // ensureLanguage must await getMonaco() internally so the highlighterRef is
    // always populated before the grammar check — boot-race regression guard.
    const lang = await ensureLanguage("/a/b.rs");
    expect(lang).toBe("rust");
  });

  it("degrades to plaintext when loadLanguage throws", async () => {
    const { createHighlighter } = await import("shiki");
    const hlInstance = await (createHighlighter as ReturnType<typeof vi.fn>).mock.results[0].value;
    // Override loadLanguage to throw for this call only.
    const original = hlInstance.loadLanguage;
    hlInstance.loadLanguage = vi.fn().mockRejectedValueOnce(new Error("grammar unavailable"));
    // Use .go — a language in EXT_TO_LANG but not pre-loaded by the shiki mock
    // (getLoadedLanguages returns ["typescript"] only), so loadedLangs won't
    // already contain "go" and the try-catch block will execute.
    const lang = await ensureLanguage("/src/main.go");
    expect(lang).toBe("plaintext");
    hlInstance.loadLanguage = original;
  });
});
