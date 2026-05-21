// Custom Windows/Linux window chrome — replaces native decorations when
// `decorations: false` is set in tauri.conf.json. macOS keeps native traffic
// lights via `titleBarStyle: "Overlay"` and does not render this component.
import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

async function safe<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch {
    /* running outside Tauri (tests / vite dev in browser) */
  }
}

export function WindowControls({ className }: Props) {
  const onMinimize = () => safe(() => getCurrentWindow().minimize());
  const onMaxToggle = () => safe(() => getCurrentWindow().toggleMaximize());
  const onClose = () => safe(() => getCurrentWindow().close());

  return (
    <div
      data-testid="window-controls"
      className={cn("no-drag flex items-center", className)}
      style={{ height: "var(--titlebar-height)" }}
    >
      <button
        type="button"
        aria-label="minimize"
        onClick={onMinimize}
        className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label="maximize"
        onClick={onMaxToggle}
        className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground"
      >
        <Square className="h-3 w-3" />
      </button>
      <button
        type="button"
        aria-label="close"
        onClick={onClose}
        className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors duration-100 hover:bg-destructive hover:text-destructive-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
