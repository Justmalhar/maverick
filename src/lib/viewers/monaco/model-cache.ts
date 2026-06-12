// Refcounted text models keyed by absolute path. CodeViewer and DiffViewer
// share one model per file so edits persist across Diff⟷Edit mode switches.
import { getMonaco, ensureLanguage } from "./loader";
import type * as MonacoApi from "monaco-editor";

type TextModel = MonacoApi.editor.ITextModel;

const cache = new Map<string, { model: TextModel; refs: number }>();

export async function getOrCreateModel(path: string, content: string): Promise<TextModel> {
  const entry = cache.get(path);
  if (entry) {
    entry.refs += 1;
    return entry.model;
  }
  const monaco = await getMonaco();
  const lang = await ensureLanguage(path);
  const uri = monaco.Uri.file(path);
  const model =
    monaco.editor.getModel(uri) ?? monaco.editor.createModel(content, lang, uri);
  cache.set(path, { model, refs: 1 });
  return model;
}

export function releaseModel(path: string): void {
  const entry = cache.get(path);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs <= 0) {
    cache.delete(path);
    entry.model.dispose();
  }
}

/** Test-only. */
export function __resetModelCache(): void {
  cache.clear();
}
