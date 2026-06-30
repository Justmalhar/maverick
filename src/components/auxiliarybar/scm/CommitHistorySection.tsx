import { useState } from "react";
import { ChevronRight } from "lucide-react";
import CommitLog from "@/panels/git/CommitLog";
import { cn } from "@/lib/utils";

export function CommitHistorySection({ worktreePath }: { worktreePath: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-0 shrink-0 flex-col border-t border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="scm-history-header"
        className="flex shrink-0 items-center gap-1 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
        Commit History
      </button>
      {open && (
        <div className="h-48" data-testid="scm-history-body">
          <CommitLog worktreePath={worktreePath} />
        </div>
      )}
    </div>
  );
}
