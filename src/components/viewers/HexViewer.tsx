import { useEffect, useState } from "react";
import RawPreview from "@/panels/preview/RawPreview";
import { fileRead } from "@/lib/tauri";
import type { ViewerProps } from "@/lib/viewers/types";

export default function HexViewer({ tab }: ViewerProps) {
  const [content, setContent] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fileRead(tab.path).then((res) => {
      if (!cancelled) setContent(res.unreadable ? "" : res.content);
    });
    return () => {
      cancelled = true;
    };
  }, [tab.path]);

  return <RawPreview filePath={tab.path} content={content} />;
}
