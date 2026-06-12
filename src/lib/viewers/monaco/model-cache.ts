// Refcounted text models keyed by absolute path. CodeViewer and DiffViewer
// share one model per file so edits persist across Diff⟷Edit mode switches.
import { getMonaco, ensureLanguage } from "./loader";
import type * as MonacoApi from "monaco-editor";

type TextModel = MonacoApi.editor.ITextModel;

const cache = new Map<string, { model: TextModel; refs: number }>();

// Dedup concurrent callers that race before the cache entry is written.
// Each caller that joins an in-flight promise increments refs independently
// once the model is available, so N concurrent callers yield refs === N.
const inflight = new Map<string, Promise<TextModel>>();

export async function getOrCreateModel(path: string, content: string): Promise<TextModel> {
  const entry = cache.get(path);
  if (entry) {
    entry.refs += 1;
    return entry.model;
  }

  const inFlight = inflight.get(path);
  if (inFlight) {
    const model = await inFlight;
    // The creator already inserted the cache entry; increment for this caller.
    const cachedEntry = cache.get(path);
    if (cachedEntry) cachedEntry.refs += 1;
    return model;
  }

  const work = (async (): Promise<TextModel> => {
    const monaco = await getMonaco();
    const lang = await ensureLanguage(path);
    const uri = monaco.Uri.file(path);
    const model =
      monaco.editor.getModel(uri) ?? monaco.editor.createModel(content, lang, uri);
    cache.set(path, { model, refs: 1 });
    return model;
  })();

  inflight.set(path, work);
  try {
    return await work;
  } finally {
    inflight.delete(path);
  }
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
  inflight.clear();
}
