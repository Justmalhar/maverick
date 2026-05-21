// macOS-only spacer reserving the 78px gutter where the native traffic lights
// are painted by the OS (we set `titleBarStyle: "Overlay"` + `hiddenTitle:
// true`). The visible dots are a non-interactive design hint that mirrors the
// native chrome position — Tauri owns the real button hit testing.
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

export function TrafficLights({ className }: Props) {
  return (
    <div
      data-testid="traffic-lights"
      aria-hidden="true"
      className={cn(
        "no-drag pointer-events-none flex h-full items-center gap-2 pl-[18px] pr-3",
        // ~78px reserves the macOS native traffic-light zone so our own
        // interactive UI never collides with the OS buttons.
        "w-[78px] min-w-[78px]",
        className
      )}
    >
      <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
      <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
      <span className="h-3 w-3 rounded-full bg-[#28c840]" />
    </div>
  );
}
