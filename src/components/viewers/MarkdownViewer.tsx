import { lazy, Suspense, useEffect, useState } from "react";
import MarkdownPreview from "@/panels/preview/MarkdownPreview";
import { fileRead } from "@/lib/tauri";
import type { ViewerProps } from "@/lib/viewers/types";

// CodeViewer is lazy-loaded to avoid circular imports and keep the shell bundle small.
const CodeViewer = lazy(() => import("./CodeViewer"));

export default function MarkdownViewer({ tab, meta, initial, onDirtyChange, registerActions }: ViewerProps) {
  const [content, setContent] = useState(initial?.content ?? "");

  useEffect(() => {
    // FileTabPane already read the file; skip the redundant second read when it
    // handed us the text.
    if (initial) {
      setContent(initial.content);
      return;
    }
    let cancelled = false;
    fileRead(tab.path).then((res) => {
      if (!cancelled) setContent(res.unreadable || res.binary ? "" : res.content);
    });
    return () => {
      cancelled = true;
    };
  }, [tab.path, initial]);

  useEffect(() => {
    registerActions({
      copyContents: async () => {
        await navigator.clipboard.writeText(content);
      },
    });
  }, [content, registerActions]);

  // When the user switches to edit mode, render the Monaco CodeViewer instead.
  if (tab.mode === "edit") {
    return (
      <Suspense fallback={null}>
        <CodeViewer tab={tab} meta={meta} initial={initial} onDirtyChange={onDirtyChange} registerActions={registerActions} />
      </Suspense>
    );
  }

  return <MarkdownPreview content={content} />;
}
