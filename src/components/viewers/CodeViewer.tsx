import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { getMonaco } from "@/lib/viewers/monaco/loader";
import { getOrCreateModel, releaseModel } from "@/lib/viewers/monaco/model-cache";
import { fileRead, fileWrite, onFsChanged } from "@/lib/tauri";
import type { ViewerProps } from "@/lib/viewers/types";
import { Button } from "@/components/ui/button";

export default function CodeViewer({ tab, onDirtyChange, registerActions }: ViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MonacoApi.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<MonacoApi.editor.ITextModel | null>(null);
  // The content the disk had when we last loaded/saved; dirty = model differs.
  const baselineRef = useRef("");
  const mtimeRef = useRef(0);
  const [conflict, setConflict] = useState(false);
  const reducedMotion = useReducedMotion();
  void reducedMotion; // no animations in the editor surface itself

  useEffect(() => {
    let disposed = false;
    const disposables: Array<{ dispose(): void }> = [];

    (async () => {
      const [monaco, res] = await Promise.all([getMonaco(), fileRead(tab.path)]);
      if (disposed || !hostRef.current) return;
      baselineRef.current = res.content;
      mtimeRef.current = res.mtime;
      const model = await getOrCreateModel(tab.path, res.content);
      if (disposed) {
        releaseModel(tab.path);
        return;
      }
      modelRef.current = model;
      const editor = monaco.editor.create(hostRef.current, {
        model,
        theme: "maverick-dark",
        fontFamily: "Geist Mono, monospace",
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
          const { mtime } = await fileWrite(tab.path, content, mtimeRef.current);
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
      const unlisten = await onFsChanged(({ paths }) => {
        if (!paths.includes(tab.path)) return;
        void fileRead(tab.path).then((fresh) => {
          if (fresh.mtime === mtimeRef.current) return;
          if (model.getValue() === baselineRef.current) {
            baselineRef.current = fresh.content;
            mtimeRef.current = fresh.mtime;
            model.setValue(fresh.content);
            onDirtyChange(false);
          } else {
            setConflict(true);
          }
        });
      });
      disposables.push({ dispose: unlisten });
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
    const fresh = await fileRead(tab.path);
    baselineRef.current = fresh.content;
    mtimeRef.current = fresh.mtime;
    modelRef.current?.setValue(fresh.content);
    setConflict(false);
    onDirtyChange(false);
  };

  const overwriteDisk = async () => {
    const content = modelRef.current?.getValue() ?? "";
    const { mtime } = await fileWrite(tab.path, content);
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
