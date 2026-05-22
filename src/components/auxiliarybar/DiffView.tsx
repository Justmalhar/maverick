import { useEffect, useState } from "react";
import { GitCompare, GitCommitVertical, GitPullRequest, Bot } from "lucide-react";
import { useWorkbench, selectActiveWorkspace } from "@/state/store";
import { diffGet } from "@/lib/tauri";
import type { DiffResult } from "@/lib/ipc";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const STATUS_TONE = {
  M: "text-warning",
  A: "text-success",
  D: "text-destructive",
  R: "text-info",
} as const;

function EmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof GitCompare;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
      <Icon className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
      <span className="text-[13px] text-foreground">{title}</span>
      <p className="max-w-xs text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function DiffView() {
  const active = useWorkbench(selectActiveWorkspace);
  const [diff, setDiff] = useState<DiffResult | null>(null);

  useEffect(() => {
    if (!active?.worktreePath) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    diffGet(active.worktreePath)
      .then((d) => {
        if (!cancelled) setDiff(d);
      })
      .catch(() => {
        if (!cancelled) setDiff(null);
      });
    return () => {
      cancelled = true;
    };
  }, [active?.worktreePath]);

  if (!active) {
    return (
      <EmptyState
        icon={GitCompare}
        title="No active workspace"
        hint="Open a workspace from a project to view its git diff."
      />
    );
  }

  const files = diff?.files ?? [];
  if (files.length === 0) {
    return (
      <EmptyState
        icon={GitCommitVertical}
        title="Working tree clean"
        hint="No staged or unstaged changes in this worktree."
      />
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="diff-view">
      {/* Action buttons */}
      <div className="flex shrink-0 gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-sidebar-hover px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors duration-100 hover:bg-muted"
        >
          <Bot className="h-3.5 w-3.5" />
          AI Code Review
        </button>
        <button
          type="button"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-sidebar-hover px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors duration-100 hover:bg-muted"
        >
          <GitPullRequest className="h-3.5 w-3.5" />
          Create PR
        </button>
      </div>

      <ScrollArea className="flex-1">
        <ul className="py-1">
          {files.map((f) => (
            <li
              key={f.path}
              className="group/row flex items-center gap-2 px-3 text-xs text-sidebar-fg transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground"
              style={{ height: "22px" }}
            >
              <span
                className={cn(
                  "w-3 shrink-0 text-center text-[10px] font-semibold",
                  STATUS_TONE[f.status]
                )}
              >
                {f.status}
              </span>
              <span className="flex-1 truncate">{f.path}</span>
              <span className="text-[10px] text-success">+{f.additions}</span>
              <span className="text-[10px] text-destructive">−{f.deletions}</span>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}
