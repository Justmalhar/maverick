// Recursive SVG preview of a PresetNode layout tree.
import type { WorkspacePreset, PresetNode } from "@/lib/ipc";

interface Props {
  preset: WorkspacePreset;
  width?: number;
  height?: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

function collectRects(node: PresetNode, x: number, y: number, w: number, h: number): Rect[] {
  if (node.type === "terminal") {
    return [{ x, y, w, h, fill: "currentColor" }];
  }
  if (node.type === "browser") {
    return [{ x, y, w, h, fill: "hsl(var(--foreground) / 0.4)" }];
  }
  // split
  const ratio = Math.min(Math.max(node.ratio, 0.1), 0.9);
  if (node.direction === "h") {
    const lw = w * ratio;
    const left = "left" in node ? node.left : node.top;
    const right = "right" in node ? node.right : node.bottom;
    return [
      ...collectRects(left, x, y, lw, h),
      ...collectRects(right, x + lw, y, w - lw, h),
    ];
  } else {
    const lh = h * ratio;
    const top = "top" in node ? node.top : node.left;
    const bottom = "bottom" in node ? node.bottom : node.right;
    return [
      ...collectRects(top, x, y, w, lh),
      ...collectRects(bottom, x, y + lh, w, h - lh),
    ];
  }
}

export default function PresetThumbnail({ preset, width = 40, height = 30 }: Props) {
  const rects = collectRects(preset.layout, 1, 1, width - 2, height - 2);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      data-testid="preset-thumbnail"
      className="shrink-0 text-muted-foreground"
    >
      <rect
        x={0.5}
        y={0.5}
        width={width - 1}
        height={height - 1}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        rx={2}
      />
      {rects.map((r, idx) => (
        <rect
          key={idx}
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          fill="none"
          stroke="currentColor"
          strokeWidth={0.6}
          rx={1}
        />
      ))}
    </svg>
  );
}
