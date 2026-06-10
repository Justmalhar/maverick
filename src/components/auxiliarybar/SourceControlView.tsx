// VSCode-style quick source control: stage-by-selection commit, AI commit
// message, push/pull (via useSourceControl), provider-aware PR creation.
import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  GitBranch,
  GitCommitVertical,
  GitPullRequest,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useWorkbench, selectActiveWorkspace } from "@/state/store";
import { useSourceControl } from "@/hooks/useSourceControl";
import {
  aiCommitMessage,
  diffGet,
  gitCommit,
  gitRemoteInfo,
  prCreate,
} from "@/lib/tauri";
import type { DiffFile, RemoteInfo } from "@/lib/ipc";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const STATUS_TONE = {
  M: "text-warning",
  A: "text-success",
  D: "text-destructive",
  R: "text-info",
} as const;

const PROVIDER_LABEL = {
  github: "GitHub",
  bitbucket: "Bitbucket",
  gitlab: "GitLab",
  unknown: "Git",
} as const;

type Busy = "none" | "generate" | "commit" | "pr";

interface Feedback {
  tone: "info" | "error";
  text: string;
  url?: string;
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  spinning,
  testId,
}: {
  icon: typeof GitCommitVertical;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  spinning?: boolean;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-sidebar-hover px-2 py-1.5 text-[11px] font-medium text-foreground transition-colors duration-100 hover:bg-muted disabled:opacity-60"
    >
      {spinning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

export function SourceControlView() {
  const active = useWorkbench(selectActiveWorkspace);
  const scm = useSourceControl(active?.worktreePath ?? null);
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [remote, setRemote] = useState<RemoteInfo | null>(null);
  const [busy, setBusy] = useState<Busy>("none");
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const refreshFiles = useCallback(async () => {
    if (!active?.worktreePath) return;
    const [diff, info] = await Promise.all([
      diffGet(active.worktreePath).catch(() => null),
      gitRemoteInfo(active.worktreePath).catch(() => null),
    ]);
    const list = diff?.files ?? [];
    setFiles(list);
    setSelected(new Set(list.map((f) => f.path)));
    setRemote(info);
  }, [active?.worktreePath]);

  useEffect(() => {
    setFeedback(null);
    setMessage("");
    void refreshFiles();
  }, [refreshFiles]);

  if (!active) {
    return (
      <div
        data-testid="scm-empty"
        className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center"
      >
        <GitBranch className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
        <span className="text-[13px] text-foreground">No active workspace</span>
        <p className="max-w-xs text-xs text-muted-foreground">
          Open a workspace to commit, push, and create pull requests.
        </p>
      </div>
    );
  }

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function run(kind: Busy, action: () => Promise<Feedback | null>) {
    if (busy !== "none") return;
    setBusy(kind);
    setFeedback(null);
    try {
      const result = await action();
      if (result) setFeedback(result);
    } catch (e) {
      setFeedback({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy("none");
    }
  }

  const onGenerate = () =>
    run("generate", async () => {
      const { message: generated } = await aiCommitMessage(active.worktreePath);
      setMessage(generated);
      return null;
    });

  const onCommit = () =>
    run("commit", async () => {
      if (!message.trim()) return { tone: "error", text: "Enter a commit message first." };
      if (selected.size === 0) return { tone: "error", text: "Select at least one file." };
      const { sha } = await gitCommit(active.worktreePath, message.trim(), [...selected]);
      setMessage("");
      await refreshFiles();
      await scm.refresh();
      return { tone: "info", text: `Committed ${sha.slice(0, 7)}` };
    });

  const onPush = async () => {
    setFeedback(null);
    const r = await scm.runRemoteAction("push");
    if (!r.ok) {
      setFeedback({
        tone: "error",
        text: r.error ?? (r.blocked === "missing-upstream" ? "No upstream — use Create PR to push." : "Push blocked."),
      });
    } else {
      setFeedback({ tone: "info", text: "Pushed." });
    }
  };

  const onPull = async () => {
    setFeedback(null);
    const r = await scm.runRemoteAction("pull");
    if (!r.ok) {
      setFeedback({ tone: "error", text: r.error ?? "Pull blocked." });
    } else {
      setFeedback({ tone: "info", text: "Pulled." });
      await refreshFiles();
    }
  };

  const onCreatePr = () =>
    run("pr", async () => {
      const { url } = await prCreate(active.worktreePath);
      await scm.refresh();
      return { tone: "info", text: "Pull request:", url };
    });

  const anyBusy = busy !== "none" || scm.busyAction !== null;

  return (
    <div className="mv-scm flex h-full flex-col" data-testid="scm-view">
      {/* Branch + provider header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-sidebar-fg" />
        <span className="truncate font-medium text-foreground" data-testid="scm-branch">
          {scm.branch?.name ?? active.branch}
        </span>
        {scm.ahead > 0 && (
          <span className="text-[10px] text-success" data-testid="scm-ahead">↑{scm.ahead}</span>
        )}
        {scm.behind > 0 && (
          <span className="text-[10px] text-warning" data-testid="scm-behind">↓{scm.behind}</span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground" data-testid="scm-provider">
          {PROVIDER_LABEL[remote?.provider ?? "unknown"]}
        </span>
        <button
          type="button"
          onClick={() => {
            void refreshFiles();
            void scm.refresh({ remote: "always" });
          }}
          aria-label="Refresh"
          data-testid="scm-refresh"
          className="flex h-5 w-5 items-center justify-center rounded-sm text-sidebar-fg transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      {/* Commit message */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2">
        <div className="relative">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Commit message (⌘⏎ to commit)"
            rows={3}
            data-testid="scm-message"
            className="resize-none pr-8 font-mono text-[11px]"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void onCommit();
            }}
          />
          <button
            type="button"
            onClick={() => void onGenerate()}
            disabled={anyBusy}
            aria-label="Generate commit message"
            data-testid="scm-generate"
            className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-sm text-accent transition-colors duration-100 hover:bg-sidebar-hover disabled:opacity-60"
          >
            {busy === "generate" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        <div className="flex gap-1.5">
          <ActionButton
            icon={GitCommitVertical}
            label="Commit"
            onClick={() => void onCommit()}
            disabled={anyBusy || files.length === 0}
            spinning={busy === "commit"}
            testId="scm-commit"
          />
          <ActionButton
            icon={ArrowUpFromLine}
            label="Push"
            onClick={() => void onPush()}
            disabled={anyBusy}
            spinning={scm.busyAction === "push"}
            testId="scm-push"
          />
          <ActionButton
            icon={ArrowDownToLine}
            label="Pull"
            onClick={() => void onPull()}
            disabled={anyBusy}
            spinning={scm.busyAction === "pull"}
            testId="scm-pull"
          />
          <ActionButton
            icon={GitPullRequest}
            label="PR"
            onClick={() => void onCreatePr()}
            disabled={anyBusy}
            spinning={busy === "pr"}
            testId="scm-pr"
          />
        </div>
        {feedback && (
          <p
            data-testid="scm-feedback"
            className={cn(
              "truncate text-[11px]",
              feedback.tone === "error" ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {feedback.text}{" "}
            {feedback.url && (
              <a
                href={feedback.url}
                target="_blank"
                rel="noreferrer"
                data-testid="scm-pr-link"
                className="text-info underline"
              >
                {feedback.url}
              </a>
            )}
          </p>
        )}
      </div>

      {/* Changed files */}
      {files.length === 0 ? (
        <div
          data-testid="scm-clean"
          className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center"
        >
          <GitCommitVertical className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
          <span className="text-[13px] text-foreground">Working tree clean</span>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <ul className="py-1" data-testid="scm-files">
            {files.map((f) => {
              const checked = selected.has(f.path);
              return (
                <li key={f.path}>
                  <button
                    type="button"
                    onClick={() => toggle(f.path)}
                    data-testid={`scm-file-${f.path}`}
                    aria-pressed={checked}
                    className="group/row flex w-full items-center gap-2 px-3 text-left text-xs text-sidebar-fg transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground"
                    style={{ height: "22px" }}
                  >
                    <span
                      className={cn(
                        "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
                        checked ? "border-accent bg-accent/20" : "border-border"
                      )}
                    >
                      {checked && <Check className="h-2.5 w-2.5 text-accent" />}
                    </span>
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
                  </button>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}
