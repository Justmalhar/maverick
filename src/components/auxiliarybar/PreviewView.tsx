import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { useWorkbench } from "@/state/store";
import { fileRead } from "@/lib/tauri";
import FilePreviewPanel from "@/panels/preview/FilePreviewPanel";

// The AuxiliaryBar "preview" tab. Reads the active preview file's text content
// (markdown/raw) via the sidecar and dispatches to the right previewer. Binary
// kinds (image/video/pdf) render straight from the path inside FilePreviewPanel.
export function PreviewView() {
  const previewFile = useWorkbench((s) => s.previewFile);
  const [content, setContent] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!previewFile) {
      setContent(undefined);
      return;
    }
    let cancelled = false;
    fileRead(previewFile.path)
      .then((res) => {
        if (cancelled) return;
        setContent(res.unreadable || res.binary ? "" : res.content);
      })
      .catch(() => {
        if (!cancelled) setContent("");
      });
    return () => {
      cancelled = true;
    };
  }, [previewFile]);

  if (!previewFile) {
    return (
      <div
        data-testid="preview-empty"
        className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground"
      >
        <Eye className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
        <span className="text-foreground">No file open</span>
        <p className="max-w-xs">
          Select a file in the explorer to preview it here.
        </p>
      </div>
    );
  }

  return (
    <FilePreviewPanel
      key={previewFile.path}
      filePath={previewFile.path}
      content={content}
      raw={previewFile.raw}
    />
  );
}
