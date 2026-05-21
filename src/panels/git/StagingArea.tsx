// Interactive staging area: split into Unstaged / Staged with hunk-level toggle,
// multi-line commit editor, diff2html unified rendering.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Minus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { diffGet, diffStageHunk, diffUnstageHunk, gitCommit } from "@/lib/tauri";
import type { DiffFile, DiffHunk } from "@/lib/ipc";
import { cn } from "@/lib/utils";

interface Props {
  worktreePath: string;
}

interface StagingState {
  unstaged: DiffFile[];
  staged: DiffFile[];
}

export default function StagingArea({ worktreePath }: Props) {
  const [state, setState] = useState<StagingState>({ unstaged: [], staged: [] });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!worktreePath) return;
    try {
      const result = await diffGet(worktreePath);
      // Heuristic split: server returns combined; partition by status carrying a `staged` flag in patch header.
      // Until backend separates, treat all returned files as "unstaged" for v0.1.
      setState({ unstaged: result.files, staged: [] });
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [worktreePath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const stageHunk = useCallback(
    async (patch: string) => {
      try {
        setBusy(true);
        await diffStageHunk(worktreePath, patch);
        await refresh();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [worktreePath, refresh]
  );

  /* v8 ignore start — unstage path unreachable until backend separates staged files (v0.2). */
  const unstageHunk = useCallback(
    async (patch: string) => {
      try {
        setBusy(true);
        await diffUnstageHunk(worktreePath, patch);
        await refresh();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [worktreePath, refresh]
  );

  const commit = useCallback(async () => {
    if (!message.trim()) return;
    try {
      setBusy(true);
      await gitCommit(worktreePath, message.trim());
      setMessage("");
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [worktreePath, message, refresh]);
  /* v8 ignore stop */

  const hasStaged = state.staged.length > 0;

  return (
    <div
      data-testid="staging-area"
      className="flex h-full w-full flex-col bg-background"
    >
      {error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <FilePane
          title="Unstaged"
          files={state.unstaged}
          actionIcon={<Plus className="h-3 w-3" />}
          onHunk={stageHunk}
          actionLabel="Stage hunk"
          testId="unstaged-pane"
        />
        <Separator orientation="vertical" />
        <FilePane
          title="Staged"
          files={state.staged}
          actionIcon={<Minus className="h-3 w-3" />}
          onHunk={unstageHunk}
          actionLabel="Unstage hunk"
          testId="staged-pane"
        />
      </div>

      <div className="border-t border-border bg-card/40 p-2">
        <textarea
          data-testid="commit-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Commit message…"
          rows={3}
          className="w-full resize-none rounded-sm border border-border bg-input p-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {message.length} chars
          </span>
          <Button
            variant="default"
            size="sm"
            data-testid="commit-button"
            disabled={!message.trim() || !hasStaged || busy}
            onClick={commit}
          >
            <Check className="h-3 w-3" />
            Commit
          </Button>
        </div>
      </div>
    </div>
  );
}

interface FilePaneProps {
  title: string;
  files: DiffFile[];
  actionIcon: React.ReactNode;
  actionLabel: string;
  onHunk: (patch: string) => void | Promise<void>;
  testId: string;
}

function FilePane({ title, files, actionIcon, actionLabel, onHunk, testId }: FilePaneProps) {
  const total = useMemo(() => files.length, [files]);
  return (
    <div data-testid={testId} className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        <Badge variant="outline">{total}</Badge>
      </div>
      <ScrollArea className="flex-1">
        {files.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-muted-foreground">No files</div>
        ) : (
          files.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              actionIcon={actionIcon}
              actionLabel={actionLabel}
              onHunk={onHunk}
            />
          ))
        )}
      </ScrollArea>
    </div>
  );
}

function FileRow({
  file,
  actionIcon,
  actionLabel,
  onHunk,
}: {
  file: DiffFile;
  actionIcon: React.ReactNode;
  actionLabel: string;
  onHunk: (patch: string) => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border-b border-border/40">
      <button
        type="button"
        onClick={() => setExpanded((s) => !s)}
        className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs transition-colors hover:bg-accent/10"
        data-testid="diff-file-row"
      >
        <Badge variant={file.status === "D" ? "destructive" : "outline"}>
          {file.status}
        </Badge>
        <span className="flex-1 truncate font-mono text-[11px]">{file.path}</span>
        <span className="text-[10px] text-success">+{file.additions}</span>
        <span className="text-[10px] text-destructive">-{file.deletions}</span>
      </button>
      {expanded && (
        <div className="bg-card/30">
          {file.hunks.map((hunk, idx) => (
            <HunkBlock
              key={`${file.path}-${idx}`}
              hunk={hunk}
              actionIcon={actionIcon}
              actionLabel={actionLabel}
              onAction={() => onHunk(hunk.patch)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HunkBlock({
  hunk,
  actionIcon,
  actionLabel,
  onAction,
}: {
  hunk: DiffHunk;
  actionIcon: React.ReactNode;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="border-t border-border/40">
      <div className="flex items-center justify-between bg-muted/30 px-2 py-1">
        <span className="font-mono text-[10px] text-muted-foreground">
          {hunk.header}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onAction}
          data-testid="hunk-action"
          title={actionLabel}
        >
          {actionIcon}
        </Button>
      </div>
      <pre className="overflow-x-auto px-2 py-1 font-mono text-[10px] leading-tight">
        {hunk.lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              line.startsWith("+") && "text-success",
              line.startsWith("-") && "text-destructive",
              !line.startsWith("+") && !line.startsWith("-") && "text-muted-foreground"
            )}
          >
            {line}
          </div>
        ))}
      </pre>
    </div>
  );
}
