import { useEffect, useState } from "react";
import { GitCompare, GitCommitVertical, GitPullRequest, Bot, Loader2 } from "lucide-react";
import { useWorkbench, selectActiveWorkspace } from "@/state/store";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import { diffGet, prCreate } from "@/lib/tauri";
import { runAiReview } from "@/lib/ai-review";
import type { DiffResult } from "@/lib/ipc";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type PrStatus =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; url: string }
  | { kind: "error"; message: string };

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
  testId,
}: {
  icon: typeof GitCompare;
  title: string;
  hint: string;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
      <Icon className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
      <span className="text-[13px] text-foreground">{title}</span>
      <p className="max-w-xs text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function DiffView() {
  const active = useWorkbench(selectActiveWorkspace);
  const setEditorMode = useWorkbench((s) => s.setEditorMode);
  const reviewPref = useProjectSettingsStore((s) => s.data?.preferences?.review);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [prStatus, setPrStatus] = useState<PrStatus>({ kind: "idle" });

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

  async function onReview() {
    if (!active) return;
    try {
      await runAiReview({
        workspaceId: active.id,
        worktreePath: active.worktreePath,
        reviewPref,
        onAgentFocus: () => setEditorMode(active.id, "agent"),
      });
    } catch (e) {
      console.error("AI review failed", e);
    }
  }

  async function onCreatePr() {
    if (!active || prStatus.kind === "running") return;
    if (!window.confirm("Push this branch and open a pull request?")) return;
    setPrStatus({ kind: "running" });
    try {
      const { url } = await prCreate(active.worktreePath);
      setPrStatus({ kind: "done", url });
    } catch (e) {
      setPrStatus({ kind: "error", message: String(e) });
    }
  }

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
        testId="diff-view-empty"
      />
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="diff-view">
      {/* Action buttons */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onReview}
            data-testid="diff-ai-review"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-sidebar-hover px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors duration-100 hover:bg-muted"
          >
            <Bot className="h-3.5 w-3.5" />
            AI Code Review
          </button>
          <button
            type="button"
            onClick={onCreatePr}
            disabled={prStatus.kind === "running"}
            data-testid="diff-create-pr"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-sidebar-hover px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors duration-100 hover:bg-muted disabled:opacity-60"
          >
            {prStatus.kind === "running" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <GitPullRequest className="h-3.5 w-3.5" />
            )}
            Create PR
          </button>
        </div>
        {prStatus.kind === "done" && (
          <a
            href={prStatus.url}
            target="_blank"
            rel="noreferrer"
            data-testid="diff-pr-link"
            className="truncate text-[11px] text-info underline"
          >
            {prStatus.url}
          </a>
        )}
        {prStatus.kind === "error" && (
          <p data-testid="diff-pr-error" className="truncate text-[11px] text-destructive">
            {prStatus.message}
          </p>
        )}
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
