import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { getMonaco } from "@/lib/viewers/monaco/loader";
import { getOrCreateModel, releaseModel } from "@/lib/viewers/monaco/model-cache";
import { monoFontFamily } from "@/lib/fonts";
import { fileRead, fileWrite, onFsChanged } from "@/lib/tauri";
import type { TextEncoding } from "@/lib/ipc";
import type { ViewerProps } from "@/lib/viewers/types";
import { Button } from "@/components/ui/button";

export default function CodeViewer({ tab, initial, onDirtyChange, registerActions }: ViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // FileTabPane already read this file to select the viewer; reuse that payload
  // instead of a second file_read. Held in a ref so the main effect's deps stay
  // [tab.path, …] — it's populated before mount and never changes the editor.
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const editorRef = useRef<MonacoApi.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<MonacoApi.editor.ITextModel | null>(null);
  // The content the disk had when we last loaded/saved; dirty = model differs.
  const baselineRef = useRef("");
  const mtimeRef = useRef(0);
  // The file's on-disk encoding (from a BOM) so a save round-trips it instead of
  // silently rewriting a UTF-16 file as UTF-8.
  const encodingRef = useRef<TextEncoding>("utf8");
  const [conflict, setConflict] = useState(false);
  const reducedMotion = useReducedMotion();
  void reducedMotion; // no animations in the editor surface itself

  useEffect(() => {
    let disposed = false;
    const disposables: Array<{ dispose(): void }> = [];

    (async () => {
      const seed = initialRef.current;
      const [monaco, res] = await Promise.all([
        getMonaco(),
        seed ? Promise.resolve(seed) : fileRead(tab.path),
      ]);
      if (disposed || !hostRef.current) return;
      baselineRef.current = res.content;
      mtimeRef.current = res.mtime;
      encodingRef.current = res.encoding;
      const model = await getOrCreateModel(tab.path, res.content);
      if (disposed) {
        releaseModel(tab.path);
        return;
      }
      modelRef.current = model;
      const editor = monaco.editor.create(hostRef.current, {
        model,
        theme: "maverick-dark",
        fontFamily: monoFontFamily(),
        fontSize: 12,
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        renderWhitespace: "selection",
      });
      editorRef.current = editor;

      disposables.push(
        model.onDidChangeContent(() => {
          onDirtyChange(model.getValue() !== baselineRef.current);
        })
      );

      const save = async () => {
        const content = model.getValue();
        try {
          const { mtime } = await fileWrite(tab.path, content, mtimeRef.current, encodingRef.current);
          baselineRef.current = content;
          mtimeRef.current = mtime;
          setConflict(false);
          onDirtyChange(false);
        } catch (err) {
          if (err instanceof Error && /changed on disk/i.test(err.message)) {
            setConflict(true);
            return;
          }
          throw err;
        }
      };

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void save());

      registerActions({
        save,
        copyContents: async () => {
          await navigator.clipboard.writeText(model.getValue());
        },
      });

      // External edits: reload clean tabs in place; dirty tabs get the conflict bar.
      // Guard: if cleanup ran before the listen promise resolves, invoke unlisten
      // immediately to prevent a leaked listener.
      const unlisten = await onFsChanged(({ paths }) => {
        if (!paths.includes(tab.path)) return;
        void fileRead(tab.path).then((fresh) => {
          if (fresh.mtime === mtimeRef.current) return;
          if (model.getValue() === baselineRef.current) {
            baselineRef.current = fresh.content;
            mtimeRef.current = fresh.mtime;
            encodingRef.current = fresh.encoding;
            model.setValue(fresh.content);
            onDirtyChange(false);
          } else {
            setConflict(true);
          }
        });
      });
      if (disposed) {
        unlisten();
      } else {
        disposables.push({ dispose: unlisten });
      }
    })();

    return () => {
      disposed = true;
      disposables.forEach((d) => d.dispose());
      editorRef.current?.dispose();
      editorRef.current = null;
      if (modelRef.current) {
        releaseModel(tab.path);
        modelRef.current = null;
      }
    };
  }, [tab.path, onDirtyChange, registerActions]);

  const reloadFromDisk = async () => {
    // Guard: model may be null if called after unmount.
    if (!modelRef.current) return;
    const fresh = await fileRead(tab.path);
    if (!modelRef.current) return; // unmounted during the await
    baselineRef.current = fresh.content;
    mtimeRef.current = fresh.mtime;
    encodingRef.current = fresh.encoding;
    modelRef.current.setValue(fresh.content);
    setConflict(false);
    onDirtyChange(false);
  };

  const overwriteDisk = async () => {
    // Guard: writing an empty string if the model is null would silently
    // truncate the file. Bail out instead.
    const model = modelRef.current;
    if (!model) return;
    const content = model.getValue();
    const { mtime } = await fileWrite(tab.path, content, undefined, encodingRef.current);
    if (!modelRef.current) return; // unmounted during the await
    baselineRef.current = content;
    mtimeRef.current = mtime;
    setConflict(false);
    onDirtyChange(false);
  };

  return (
    <div className="flex h-full w-full flex-col">
      {conflict && (
        <div
          data-testid="code-viewer-conflict"
          className="flex shrink-0 items-center gap-2 border-b border-border bg-muted px-3 py-1.5 text-[11px] text-foreground"
        >
          <span className="flex-1">File changed on disk.</span>
          <Button variant="ghost" size="sm" onClick={() => void reloadFromDisk()}>
            Reload
          </Button>
          <Button variant="destructive" size="sm" onClick={() => void overwriteDisk()}>
            Overwrite
          </Button>
        </div>
      )}
      <div ref={hostRef} data-testid="code-viewer-editor" className="min-h-0 flex-1" />
    </div>
  );
}
