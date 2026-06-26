// macOS-only spacer reserving the 78px gutter where the native traffic lights
// are painted by the OS (we set `titleBarStyle: "Overlay"` + `hiddenTitle:
// true`). It renders NO dots of its own — the OS owns both the visuals and the
// hit testing. Painting our own dots here duplicates the native chrome.
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

export function TrafficLightSpacer({ className }: Props) {
  return (
    <div
      data-testid="traffic-light-spacer"
      aria-hidden="true"
      className={cn(
        "pointer-events-none h-full w-[78px] min-w-[78px] shrink-0",
        className
      )}
    />
  );
}
