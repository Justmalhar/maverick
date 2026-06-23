import { useEffect, useMemo, useState } from "react";
import { GitCompare, GitCommitVertical, GitPullRequest, Bot, Loader2, MessagesSquare } from "lucide-react";
import { useWorkbench, selectActiveWorkspace } from "@/state/store";
import { joinPath } from "@/lib/paths";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import { useReviewComments } from "@/lib/stores/review-comments";
import { useAgentStatus } from "@/hooks/useAgentStatus";
import { diffGet, prCreate } from "@/lib/tauri";
import { runAiReview, sendReviewComments } from "@/lib/ai-review";
import { primaryAgentPtyId } from "@/components/editor/terminal/TerminalLeaf";
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
  const setActiveWorkspace = useWorkbench((s) => s.setActiveWorkspace);
  const openFileTab = useWorkbench((s) => s.openFileTab);
  const reviewPref = useProjectSettingsStore((s) => s.data?.preferences?.review);
  const allComments = useReviewComments((s) => s.comments);
  const clearComments = useReviewComments((s) => s.clearForWorkspace);
  const agentStatus = useAgentStatus(active?.id ?? "");
  const comments = useMemo(
    () => allComments.filter((c) => c.workspaceId === active?.id),
    [allComments, active?.id]
  );
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [prStatus, setPrStatus] = useState<PrStatus>({ kind: "idle" });

  const onOpenDiff = (relPath: string) => {
    if (!active?.worktreePath) return;
    openFileTab({
      kind: "diff",
      path: joinPath(active.worktreePath, relPath),
      worktreePath: active.worktreePath,
      preview: true,
    });
  };

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
        agentPtyId: primaryAgentPtyId(active.id),
        worktreePath: active.worktreePath,
        reviewPref,
        onAgentFocus: () => setActiveWorkspace(active.id),
      });
    } catch (e) {
      console.error("AI review failed", e);
    }
  }

  async function onSendComments() {
    if (!active || comments.length === 0) return;
    try {
      const res = await sendReviewComments({
        agentPtyId: primaryAgentPtyId(active.id),
        comments,
        onAgentFocus: () => setActiveWorkspace(active.id),
      });
      if (res.ran) clearComments(active.id);
    } catch (e) {
      console.error("Send review comments failed", e);
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
        {comments.length > 0 && (
          <button
            type="button"
            onClick={onSendComments}
            disabled={agentStatus === "working"}
            data-testid="diff-send-comments"
            title={
              agentStatus === "working"
                ? "Agent is working — wait until it's idle to send comments"
                : "Send your inline review comments to the agent"
            }
            className="flex items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-foreground transition-colors duration-100 hover:bg-accent/90 disabled:opacity-50"
          >
            <MessagesSquare className="h-3.5 w-3.5" />
            Send {comments.length} comment{comments.length === 1 ? "" : "s"} to agent
          </button>
        )}
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
              <button
                type="button"
                onClick={() => onOpenDiff(f.path)}
                data-testid={`diff-file-${f.path}`}
                className="flex-1 truncate text-left hover:underline"
              >
                {f.path}
              </button>
              <span className="text-[10px] text-success">+{f.additions}</span>
              <span className="text-[10px] text-destructive">−{f.deletions}</span>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}
