import { useEffect, useRef } from "react";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { getMonaco, ensureLanguage } from "@/lib/viewers/monaco/loader";
import { getOrCreateModel, releaseModel } from "@/lib/viewers/monaco/model-cache";
import { fileRead, fileReadAtRef, fileWrite, gitDiscardFile } from "@/lib/tauri";
import type { ViewerProps } from "@/lib/viewers/types";

function relPath(tab: { path: string; worktreePath: string }): string {
  return tab.path.startsWith(tab.worktreePath)
    ? tab.path.slice(tab.worktreePath.length).replace(/^\//, "")
    : tab.path;
}

export default function DiffViewer({ tab, onDirtyChange, registerActions }: ViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MonacoApi.editor.IStandaloneDiffEditor | null>(null);
  const originalRef = useRef<MonacoApi.editor.ITextModel | null>(null);
  const baselineRef = useRef("");
  const mtimeRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    let acquired = false; // true only after getOrCreateModel succeeds and disposed was false
    const disposables: Array<{ dispose(): void }> = [];

    (async () => {
      const [monaco, working, head] = await Promise.all([
        getMonaco(),
        fileRead(tab.path),
        fileReadAtRef(tab.worktreePath, relPath(tab), "HEAD"),
      ]);
      if (disposed || !hostRef.current) return;
      baselineRef.current = working.content;
      mtimeRef.current = working.mtime;

      const lang = await ensureLanguage(tab.path);
      // Original side is read-only and ref-less — created fresh, disposed here.
      const original = monaco.editor.createModel(head.missing ? "" : head.content, lang);
      originalRef.current = original;
      const modified = await getOrCreateModel(tab.path, working.content);
      if (disposed) {
        // The guard releases the ref that getOrCreateModel just acquired.
        // Do NOT also release in cleanup (acquired remains false).
        original.dispose();
        releaseModel(tab.path);
        return;
      }
      acquired = true;

      const editor = monaco.editor.createDiffEditor(hostRef.current, {
        theme: "maverick-dark",
        fontFamily: "Geist Mono, monospace",
        fontSize: 12,
        automaticLayout: true,
        renderSideBySide: true,
        originalEditable: false,
        minimap: { enabled: false },
      });
      editor.setModel({ original, modified });
      editorRef.current = editor;

      disposables.push(
        modified.onDidChangeContent(() => {
          onDirtyChange(modified.getValue() !== baselineRef.current);
        })
      );

      const save = async () => {
        const content = modified.getValue();
        const { mtime } = await fileWrite(tab.path, content, mtimeRef.current);
        baselineRef.current = content;
        mtimeRef.current = mtime;
        onDirtyChange(false);
      };

      editor.getModifiedEditor().addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void save());

      registerActions({
        save,
        copyContents: async () => {
          await navigator.clipboard.writeText(modified.getValue());
        },
        discardChanges: async () => {
          await gitDiscardFile(tab.worktreePath, relPath(tab));
          const fresh = await fileRead(tab.path);
          baselineRef.current = fresh.content;
          mtimeRef.current = fresh.mtime;
          modified.setValue(fresh.content);
          onDirtyChange(false);
        },
      });
    })();

    return () => {
      disposed = true;
      disposables.forEach((d) => d.dispose());
      editorRef.current?.dispose();
      editorRef.current = null;
      originalRef.current?.dispose();
      originalRef.current = null;
      // Only release if this cleanup owns the ref. If disposed guard already ran
      // (acquired stays false), that path already called releaseModel exactly once.
      if (acquired) releaseModel(tab.path);
    };
  }, [tab.path, tab.worktreePath, onDirtyChange, registerActions]);

  return <div ref={hostRef} data-testid="diff-viewer-editor" className="h-full w-full" />;
}
