// Virtualised git log list — author, message, SHA, timestamp, file count.
import { useEffect, useMemo, useRef, useState } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import { formatDistanceToNow } from "date-fns";
import { GitCommit } from "lucide-react";
import type { Commit } from "@/lib/ipc";
import { gitLog } from "@/lib/tauri";
import { cn } from "@/lib/utils";

interface Props {
  worktreePath: string;
  limit?: number;
  onSelect?: (commit: Commit) => void;
}

const ROW_HEIGHT = 44;

export default function CommitLog({ worktreePath, limit = 200, onSelect }: Props) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(400);

  useEffect(() => {
    if (!worktreePath) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    gitLog(worktreePath, limit)
      .then((cs) => {
        if (!cancelled) setCommits(cs);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [worktreePath, limit]);

  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        setHeight(containerRef.current.clientHeight);
      }
    };
    update();
    const ro = new ResizeObserver(update);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const itemData = useMemo(
    () => ({ commits, selectedSha, setSelectedSha, onSelect }),
    [commits, selectedSha, onSelect]
  );

  return (
    <div
      ref={containerRef}
      data-testid="commit-log"
      className="flex h-full w-full flex-col bg-background"
    >
      {loading && (
        <div className="px-3 py-1.5 text-[11px] text-muted-foreground">Loading log…</div>
      )}
      {error && (
        <div className="px-3 py-1.5 text-[11px] text-destructive">Failed: {error}</div>
      )}
      {!loading && !error && commits.length === 0 && (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          No commits
        </div>
      )}
      {commits.length > 0 && (
        <FixedSizeList<typeof itemData>
          height={height}
          width="100%"
          itemCount={commits.length}
          itemSize={ROW_HEIGHT}
          itemData={itemData}
        >
          {CommitRow}
        </FixedSizeList>
      )}
    </div>
  );
}

interface RowData {
  commits: Commit[];
  selectedSha: string | null;
  setSelectedSha: (sha: string) => void;
  onSelect?: (commit: Commit) => void;
}

function CommitRow({ index, style, data }: ListChildComponentProps<RowData>) {
  const commit = data.commits[index];
  const isActive = data.selectedSha === commit.sha;
  return (
    <button
      type="button"
      style={style}
      data-testid="commit-row"
      onClick={() => {
        data.setSelectedSha(commit.sha);
        data.onSelect?.(commit);
      }}
      className={cn(
        "flex w-full items-center gap-2 border-b border-border/40 px-3 py-1.5 text-left text-xs transition-colors",
        isActive ? "bg-accent/20" : "hover:bg-accent/10"
      )}
    >
      <GitCommit className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="font-mono text-[10px] text-muted-foreground">
        {commit.sha.slice(0, 7)}
      </span>
      <span className="flex-1 truncate text-foreground">{commit.message}</span>
      <span className="hidden truncate text-[10px] text-muted-foreground sm:inline">
        {commit.author}
      </span>
      <span className="text-[10px] text-muted-foreground">
        {formatDistanceToNow(new Date(commit.timestamp * 1000), { addSuffix: false })}
      </span>
    </button>
  );
}
