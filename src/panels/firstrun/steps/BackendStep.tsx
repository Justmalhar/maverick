import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Loader2, ExternalLink } from "lucide-react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { bootstrapUpdateSettings, detectBackends } from "@/lib/tauri";
import type { DetectedBackend } from "@/lib/ipc";
import { brandFor } from "@/lib/backend-brand";
import { cn } from "@/lib/utils";

export function BackendStep() {
  const [rows, setRows] = useState<DetectedBackend[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    detectBackends()
      .then((r) => {
        if (!cancelled) setRows(Array.isArray(r) ? r : []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function pick(name: string) {
    setPicked(name);
    await bootstrapUpdateSettings({ defaultBackend: name });
  }

  const installed = rows?.filter((r) => r.installed) ?? [];
  const missing = rows?.filter((r) => !r.installed) ?? [];

  return (
    <div data-testid="firstrun-step-backend" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">Default agent</h2>
        <p className="text-[12px] text-muted-foreground">
          We checked your machine for known coding agents. Pick one as the default for new
          workspaces, or skip and choose each time.
        </p>
      </div>

      {rows === null ? (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Scanning your system…
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {installed.length > 0 && (
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {installed.map((row) => (
                <BackendRow
                  key={row.name}
                  row={row}
                  selected={picked === row.name}
                  onPick={() => void pick(row.name)}
                />
              ))}
            </ul>
          )}
          {missing.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Not detected
              </span>
              <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {missing.map((row) => (
                  <BackendRow key={row.name} row={row} selected={false} onPick={undefined} />
                ))}
              </ul>
            </div>
          )}
          {installed.length === 0 && missing.length === 0 && (
            <p className="text-[12px] text-muted-foreground">
              No known agents found. You can install one later and pick it from Settings.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface RowProps {
  row: DetectedBackend;
  selected: boolean;
  onPick: (() => void) | undefined;
}

function BackendRow({ row, selected, onPick }: RowProps) {
  const brand = brandFor(row.name);
  const Icon = brand?.Icon;
  const label = brand?.label ?? row.name;
  const tagline = brand?.tagline ?? (row.installed ? "Installed" : "Not detected on this machine");
  return (
    <li>
      <label
        className={cn(
          "flex w-full cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5",
          selected ? "bg-primary/10" : "bg-muted/30 hover:bg-muted",
          !row.installed && "cursor-default opacity-70"
        )}
        style={{
          borderColor: selected
            ? "hsl(var(--primary))"
            : "hsl(var(--muted-foreground) / 0.25)",
        }}
      >
        <input
          type="radio"
          name="default-backend"
          aria-label={label}
          disabled={!row.installed}
          checked={selected}
          /* v8 ignore next — disabled radios cannot fire onChange in the DOM */
          onChange={onPick ?? (() => undefined)}
          className="accent-primary"
        />
        {Icon ? (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-background">
            <Icon size={20} />
          </span>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5 text-[13px] text-foreground">
            {label}
            {row.installed ? (
              <CheckCircle2 className="h-3 w-3 text-success" />
            ) : (
              <Circle className="h-3 w-3 text-muted-foreground/60" />
            )}
          </span>
          <span className="truncate text-[10px] text-muted-foreground">{tagline}</span>
        </div>
        {!row.installed && brand?.installUrl && (
          <button
            type="button"
            className="flex shrink-0 items-center gap-1 rounded-sm px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void shellOpen(brand.installUrl);
            }}
          >
            Install
            <ExternalLink className="h-3 w-3" />
          </button>
        )}
      </label>
    </li>
  );
}
