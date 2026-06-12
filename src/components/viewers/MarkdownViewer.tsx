import { useEffect, useState } from "react";
import MarkdownPreview from "@/panels/preview/MarkdownPreview";
import { fileRead } from "@/lib/tauri";
import type { ViewerProps } from "@/lib/viewers/types";

export default function MarkdownViewer({ tab, registerActions }: ViewerProps) {
  const [content, setContent] = useState("");

  useEffect(() => {
    let cancelled = false;
    fileRead(tab.path).then((res) => {
      if (!cancelled) setContent(res.unreadable || res.binary ? "" : res.content);
    });
    return () => {
      cancelled = true;
    };
  }, [tab.path]);

  useEffect(() => {
    registerActions({
      copyContents: async () => {
        await navigator.clipboard.writeText(content);
      },
    });
  }, [content, registerActions]);

  return <MarkdownPreview content={content} />;
}
