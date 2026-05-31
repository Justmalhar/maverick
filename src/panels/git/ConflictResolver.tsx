// Side-by-side conflict view: Accept Ours / Accept Theirs / Accept Both per hunk.
import { useCallback, useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { gitConflicts, gitResolveConflict } from "@/lib/tauri";
import type { ConflictHunk, ConflictResolution as Resolution } from "@/lib/ipc";

interface Props {
  worktreePath: string;
}

export default function ConflictResolver({ worktreePath }: Props) {
  const [hunks, setHunks] = useState<ConflictHunk[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!worktreePath) return;
    setLoading(true);
    setError(null);
    try {
      const result = await gitConflicts(worktreePath);
      setHunks(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [worktreePath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const resolve = useCallback(
    async (hunk: ConflictHunk, resolution: Resolution) => {
      try {
        await gitResolveConflict(worktreePath, hunk.filePath, hunk.hunkIndex, resolution);
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [worktreePath, refresh]
  );

  return (
    <div
      data-testid="conflict-resolver"
      className="flex h-full w-full flex-col bg-background"
    >
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Conflicts
        </span>
        <Badge variant={hunks.length > 0 ? "destructive" : "outline"}>
          {hunks.length}
        </Badge>
      </div>
      {loading && (
        <div className="px-3 py-1.5 text-[11px] text-muted-foreground">Loading…</div>
      )}
      {error && (
        <div className="px-3 py-1.5 text-[11px] text-destructive">{error}</div>
      )}
      <ScrollArea className="flex-1">
        {hunks.length === 0 && !loading ? (
          <div className="px-3 py-2 text-[11px] text-muted-foreground">
            No conflicts. Working tree is clean.
          </div>
        ) : (
          hunks.map((hunk) => (
            <div
              key={`${hunk.filePath}-${hunk.hunkIndex}`}
              data-testid="conflict-hunk"
              className="border-b border-border/40 p-2"
            >
              <div className="mb-1 font-mono text-[11px] text-foreground">
                {hunk.filePath} (hunk #{hunk.hunkIndex})
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-sm border border-border bg-card/30 p-2">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-success">
                    Ours
                  </div>
                  <pre className="overflow-x-auto font-mono text-[10px]">
                    {hunk.ours.join("\n")}
                  </pre>
                </div>
                <div className="rounded-sm border border-border bg-card/30 p-2">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-warning">
                    Theirs
                  </div>
                  <pre className="overflow-x-auto font-mono text-[10px]">
                    {hunk.theirs.join("\n")}
                  </pre>
                </div>
              </div>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => resolve(hunk, "ours")}
                  data-testid="resolve-ours"
                >
                  Accept Ours
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => resolve(hunk, "theirs")}
                  data-testid="resolve-theirs"
                >
                  Accept Theirs
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => resolve(hunk, "both")}
                  data-testid="resolve-both"
                >
                  Accept Both
                </Button>
              </div>
            </div>
          ))
        )}
      </ScrollArea>
    </div>
  );
}
