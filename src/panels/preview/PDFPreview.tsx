// pdfjs-dist — page navigation, zoom, text layer.
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Props {
  filePath: string;
}

// Module-level worker config (idempotent).
/* v8 ignore start — module-level shim runs once before tests can mock and
   relies on import.meta.url which jsdom does not implement. */
if (typeof window !== "undefined" && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();
  } catch {
    /* SSR / test environments may not support new URL — skip */
  }
}
/* v8 ignore stop */

export default function PDFPreview({ filePath }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let cleanupDoc: pdfjsLib.PDFDocumentProxy | null = null;
    pdfjsLib
      .getDocument({ url: filePath })
      .promise.then((d) => {
        if (cancelled) {
          d.destroy();
          return;
        }
        cleanupDoc = d;
        setDoc(d);
        setPage(1);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
      cleanupDoc?.destroy();
    };
  }, [filePath]);

  const render = useCallback(async () => {
    if (!doc || !canvasRef.current) return;
    try {
      const p = await doc.getPage(page);
      const viewport = p.getViewport({ scale });
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await p.render({ canvasContext: ctx, viewport }).promise;
    } catch (e) {
      setError(String(e));
    }
  }, [doc, page, scale]);

  useEffect(() => {
    render();
  }, [render]);

  return (
    <div data-testid="pdf-preview" className="flex h-full w-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-border bg-card/30 px-2 py-1">
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          data-testid="pdf-prev"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {page} / {doc?.numPages ?? "—"}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={!doc || page >= doc.numPages}
          onClick={() => setPage((p) => p + 1)}
          data-testid="pdf-next"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <div className="flex-1" />
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => setScale((s) => Math.max(0.25, s - 0.25))}
          data-testid="pdf-zoom-out"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <span className="text-[11px] text-muted-foreground">{Math.round(scale * 100)}%</span>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => setScale((s) => Math.min(3, s + 0.25))}
          data-testid="pdf-zoom-in"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
      </div>
      <ScrollArea className="flex-1 bg-muted/20">
        <div className="flex justify-center p-4">
          {error ? (
            <div className="text-[11px] text-destructive">{error}</div>
          ) : (
            <canvas ref={canvasRef} data-testid="pdf-canvas" />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
