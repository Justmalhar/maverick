// Router: dispatch to correct preview component by MIME / extension.
import { useMemo } from "react";
import MarkdownPreview from "./MarkdownPreview";
import PDFPreview from "./PDFPreview";
import ImagePreview from "./ImagePreview";
import VideoPreview from "./VideoPreview";
import RawPreview from "./RawPreview";

interface Props {
  filePath: string;
  mimeType?: string;
  content?: string;
  /** When true, markdown files render as raw source instead of the rendered view. */
  raw?: boolean;
}

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"];
const VIDEO_EXT = ["mp4", "webm", "mov", "m4v"];

function ext(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx >= 0 ? path.slice(idx + 1).toLowerCase() : "";
}

export default function FilePreviewPanel({ filePath, mimeType = "", content, raw = false }: Props) {
  const kind = useMemo<"markdown" | "pdf" | "image" | "video" | "raw">(() => {
    if (mimeType === "text/markdown") return raw ? "raw" : "markdown";
    if (mimeType === "application/pdf") return "pdf";
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    const e = ext(filePath);
    if (e === "md" || e === "markdown") return raw ? "raw" : "markdown";
    if (e === "pdf") return "pdf";
    if (IMAGE_EXT.includes(e)) return "image";
    if (VIDEO_EXT.includes(e)) return "video";
    return "raw";
  }, [filePath, mimeType, raw]);

  return (
    <div
      data-testid="file-preview-panel"
      className="flex h-full w-full flex-col bg-background"
    >
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {filePath}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {kind === "markdown" && <MarkdownPreview content={content ?? ""} />}
        {kind === "pdf" && <PDFPreview filePath={filePath} />}
        {kind === "image" && <ImagePreview filePath={filePath} />}
        {kind === "video" && <VideoPreview filePath={filePath} />}
        {kind === "raw" && <RawPreview filePath={filePath} content={content} />}
      </div>
    </div>
  );
}
