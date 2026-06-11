import { useEffect, useState } from "react";
import { Coffee } from "lucide-react";
import { caffeinateStart, caffeinateStatus, caffeinateStop } from "@/lib/tauri";
import { cn } from "@/lib/utils";

export function CaffeinateToggle() {
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    caffeinateStatus()
      .then(({ active }) => {
        if (!cancelled) setActive(active);
      })
      .catch(() => {
        /* default to inactive */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const result = active ? await caffeinateStop() : await caffeinateStart();
      setActive(result.active);
    } catch {
      /* leave state unchanged */
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      data-testid="statusbar-caffeine"
      aria-pressed={active}
      aria-label={active ? "Disable keep-awake" : "Enable keep-awake"}
      className={cn(
        "mv-statusbar-item flex h-full items-center gap-1 px-1.5 text-[11px] leading-none transition-colors duration-100",
        active
          ? "bg-statusbar-prominent text-statusbar-fg"
          : "text-statusbar-fg/70 hover:bg-statusbar-prominent hover:text-statusbar-fg"
      )}
    >
      <Coffee className="h-3 w-3" />
      <span>{active ? "awake" : "caffeinate"}</span>
    </button>
  );
}
