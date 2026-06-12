// The ONLY module allowed to import monaco-editor (CLAUDE.md rule 4 analogue:
// everything else goes through getMonaco()). Loaded lazily — first file tab
// pays the chunk cost, the Workbench never does.
import type * as MonacoApi from "monaco-editor";
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
  return monaco;
}

let highlighterRef: Awaited<ReturnType<typeof import("shiki").createHighlighter>> | null = null;
let loadedLangs = new Set<string>();

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
    } catch {
      return "plaintext"; // grammar unavailable — degrade, don't fail the tab
    }
  }
  return lang;
}
