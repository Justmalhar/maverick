// Inline image preview: scroll-zoom, drag-pan, fit-to-window.
import { useCallback, useRef, useState, type MouseEvent, type WheelEvent } from "react";
import { Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  filePath: string;
}

export default function ImagePreview({ filePath }: Props) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef<{ x: number; y: number } | null>(null);

  const onWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.0015;
    setScale((s) => Math.min(8, Math.max(0.05, s + delta)));
  }, []);

  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    dragging.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
  };

  const onMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    setOffset({ x: e.clientX - dragging.current.x, y: e.clientY - dragging.current.y });
  };

  const stopDrag = () => {
    dragging.current = null;
  };

  const fit = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  return (
    <div
      data-testid="image-preview"
      className="relative flex h-full w-full select-none flex-col bg-muted/10"
    >
      <div className="flex items-center gap-1.5 border-b border-border bg-card/30 px-2 py-1">
        <span className="text-[11px] text-muted-foreground">
          {Math.round(scale * 100)}%
        </span>
        <div className="flex-1" />
        <Button size="icon-sm" variant="ghost" onClick={fit} data-testid="image-fit">
          <Maximize2 className="h-3 w-3" />
        </Button>
      </div>
      <div
        className="relative flex-1 cursor-grab overflow-hidden active:cursor-grabbing"
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
      >
        <img
          src={filePath}
          alt=""
          draggable={false}
          data-testid="image-preview-img"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: "center center",
          }}
          className="absolute left-1/2 top-1/2 max-h-none max-w-none -translate-x-1/2 -translate-y-1/2 transition-transform duration-75"
        />
      </div>
    </div>
  );
}
