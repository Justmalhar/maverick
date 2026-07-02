// The ONLY module allowed to import monaco-editor (CLAUDE.md rule 4 analogue:
// everything else goes through getMonaco()). Loaded lazily — first file tab
// pays the chunk cost, the Workbench never does.
import type * as MonacoApi from "monaco-editor";
// The `editor.api` entry (unlike `editor.main`) never imports codicon.css, so the
// `@font-face { font-family: "codicon" }` is otherwise never registered and every
// codicon glyph — most visibly the diff gutter +/- signs (diff-insert/diff-remove) —
// renders as tofu boxes. Registering it here keeps us on the minimal entry.
import "monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css";
import { MAVERICK_DARK } from "./maverick-theme";
import { SHIKI_LANGS, languageForPath } from "./languages";

export type Monaco = typeof MonacoApi;

let instance: Promise<Monaco> | null = null;

async function boot(): Promise<Monaco> {
  const [monaco, { default: EditorWorker }] = await Promise.all([
    import("monaco-editor/esm/vs/editor/editor.api"),
    import("monaco-editor/esm/vs/editor/editor.worker?worker"),
  ]);

  // Shiki owns tokenization; Monaco only needs its base editor worker.
  /* v8 ignore next 3 — getWorker() is invoked by the Monaco editor when it
     spawns Web Workers; the jsdom test environment never triggers it. */
  (self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
    getWorker: () => new EditorWorker(),
  };

  const { createHighlighter } = await import("shiki");
  const { shikiToMonaco } = await import("@shikijs/monaco");

  // Languages register as empty shells; shiki grammars stream in per-language
  // on demand via ensureLanguage(), keeping first paint fast.
  for (const id of SHIKI_LANGS) monaco.languages.register({ id });
  const highlighter = await createHighlighter({ themes: [MAVERICK_DARK], langs: [] });
  shikiToMonaco(highlighter, monaco);
  monaco.editor.setTheme("maverick-dark");

  loadedLangs = new Set(highlighter.getLoadedLanguages());
  highlighterRef = highlighter;
  // shikiToMonaco only wires a Monaco tokenizer for the grammars loaded at the
  // moment it runs (none at boot — langs:[]). Every lazy loadLanguage() must
  // re-run it, otherwise the new grammar streams into shiki but Monaco keeps
  // tokenizing as plaintext and the editor shows raw, uncolored text.
  rewireMonaco = () => shikiToMonaco(highlighter, monaco);
  return monaco;
}

let highlighterRef: Awaited<ReturnType<typeof import("shiki").createHighlighter>> | null = null;
let loadedLangs = new Set<string>();
let rewireMonaco: (() => void) | null = null;

export function getMonaco(): Promise<Monaco> {
  if (!instance) {
    /* v8 ignore next 4 — boot() rejection resets the singleton; exercising it
       requires full module teardown which conflicts with the shared test harness. */
    instance = boot().catch((err: unknown) => {
      instance = null;
      throw err;
    });
  }
  return instance;
}

/** Lazy-load the TextMate grammar for a file's language; returns the language id. */
export async function ensureLanguage(path: string): Promise<string> {
  const lang = languageForPath(path);
  if (lang === "plaintext") return lang;
  await getMonaco();
  /* v8 ignore next — highlighterRef is always set by boot(); the null guard is
     defensive against a race that cannot occur in normal or test execution. */
  if (!highlighterRef) return "plaintext";
  if (!loadedLangs.has(lang)) {
    try {
      await highlighterRef.loadLanguage(lang as never);
      loadedLangs.add(lang);
      // Re-wire Monaco so the just-loaded grammar gets a tokens provider; without
      // this the model tokenizes as plaintext (no syntax highlighting).
      rewireMonaco?.();
    } catch {
      return "plaintext"; // grammar unavailable — degrade, don't fail the tab
    }
  }
  return lang;
}
