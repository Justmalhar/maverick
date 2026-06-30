import { useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import type { DiffFile } from "@/lib/ipc";
import { cn } from "@/lib/utils";

const STATUS_TONE = { M: "text-warning", A: "text-success", D: "text-destructive", R: "text-info" } as const;

export function ChangesSection({
  files,
  selected,
  onToggle,
  onOpenDiff,
}: {
  files: DiffFile[];
  selected: Set<string>;
  onToggle: (path: string) => void;
  onOpenDiff: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="flex min-h-0 flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="scm-changes-header"
        className="flex shrink-0 items-center gap-1 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
        Changes ({files.length})
      </button>
      {open && (
        <ul className="overflow-auto py-1" data-testid="scm-files">
          {files.map((f) => {
            const checked = selected.has(f.path);
            return (
              <li key={f.path}>
                <div
                  className="group/row flex w-full items-center gap-2 px-3 text-xs text-sidebar-fg transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground"
                  style={{ height: "22px" }}
                >
                  <button
                    type="button"
                    onClick={() => onToggle(f.path)}
                    data-testid={`scm-file-${f.path}`}
                    aria-pressed={checked}
                    className="flex shrink-0 items-center gap-2 text-left"
                  >
                    <span className={cn("flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border", checked ? "border-accent bg-accent/20" : "border-border")}>
                      {checked && <Check className="h-2.5 w-2.5 text-accent" />}
                    </span>
                    <span className={cn("w-3 shrink-0 text-center text-[10px] font-semibold", STATUS_TONE[f.status])}>{f.status}</span>
                  </button>
                  <button
                    type="button"
                    data-testid={`scm-open-diff-${f.path}`}
                    onClick={() => onOpenDiff(f.path)}
                    className="flex-1 truncate text-left hover:underline"
                  >
                    {f.path}
                  </button>
                  <span className="text-[10px] text-success">+{f.additions}</span>
                  <span className="text-[10px] text-destructive">−{f.deletions}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
