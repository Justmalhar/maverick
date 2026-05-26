import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { bootstrapUpdateSettings, detectBackends } from "@/lib/tauri";
import type { DetectedBackend } from "@/lib/ipc";
import { cn } from "@/lib/utils";

export function BackendStep() {
  const [rows, setRows] = useState<DetectedBackend[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    detectBackends().then((r) => {
      if (!cancelled) setRows(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function pick(name: string) {
    setPicked(name);
    await bootstrapUpdateSettings({ defaultBackend: name });
  }

  return (
    <div data-testid="firstrun-step-backend" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">Default backend</h2>
        <p className="text-[12px] text-muted-foreground">
          We scanned <span className="font-mono">$PATH</span> for known AI CLIs. Pick a default
          for new workspaces, or skip to choose each time.
        </p>
      </div>

      {rows === null ? (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Scanning your PATH…
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <li key={row.name}>
              <label
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between rounded-md border px-3 py-2",
                  picked === row.name ? "border-primary bg-primary/10" : "border-border bg-muted/30 hover:bg-muted",
                  !row.installed && "opacity-60"
                )}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="default-backend"
                    aria-label={row.name}
                    disabled={!row.installed}
                    checked={picked === row.name}
                    onChange={() => void pick(row.name)}
                    className="accent-primary"
                  />
                  {row.installed ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <span className="text-[12px] text-foreground">{row.name}</span>
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {row.installed ? (row.version ?? "installed") : "not found"}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
