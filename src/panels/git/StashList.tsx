// Stash list: stash, pop, apply, drop with names + confirmation dialogs.
import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Archive, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Stash } from "@/lib/ipc";
import { gitStashList } from "@/lib/tauri";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  worktreePath: string;
}

type StashAction = "apply" | "pop" | "drop";

export default function StashList({ worktreePath }: Props) {
  const [stashes, setStashes] = useState<Stash[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ stash: Stash; action: StashAction } | null>(null);

  const refresh = useCallback(async () => {
    if (!worktreePath) return;
    setLoading(true);
    try {
      const s = await gitStashList(worktreePath);
      setStashes(s);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [worktreePath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const confirm = useCallback(async () => {
    if (!pending) return;
    try {
      await invoke(`git_stash_${pending.action}`, {
        worktreePath,
        index: pending.stash.index,
      });
      setPending(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }, [pending, worktreePath, refresh]);

  return (
    <div data-testid="stash-list" className="flex h-full w-full flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Stashes
        </span>
        <Button variant="ghost" size="sm" onClick={refresh}>
          Refresh
        </Button>
      </div>
      {loading && (
        <div className="px-3 py-1.5 text-[11px] text-muted-foreground">Loading…</div>
      )}
      {error && (
        <div className="px-3 py-1.5 text-[11px] text-destructive">{error}</div>
      )}
      <ScrollArea className="flex-1">
        {stashes.length === 0 && !loading ? (
          <div className="px-3 py-2 text-[11px] text-muted-foreground">No stashes</div>
        ) : (
          stashes.map((s) => (
            <div
              key={s.index}
              data-testid="stash-row"
              className="flex items-center gap-2 border-b border-border/40 px-3 py-2 text-xs"
            >
              <Archive className="h-3 w-3 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-foreground">{s.message}</div>
                <div className="text-[10px] text-muted-foreground">
                  {s.branch} ·{" "}
                  {formatDistanceToNow(new Date(s.timestamp * 1000), { addSuffix: true })}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPending({ stash: s, action: "apply" })}
                data-testid="stash-apply"
              >
                Apply
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPending({ stash: s, action: "pop" })}
                data-testid="stash-pop"
              >
                Pop
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPending({ stash: s, action: "drop" })}
                data-testid="stash-drop"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))
        )}
      </ScrollArea>

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending?.action === "drop" ? "Drop stash?" : `${pending?.action} stash`}
            </DialogTitle>
            <DialogDescription>
              {pending?.action === "drop"
                ? "This permanently removes the stash. This action cannot be undone."
                : `Apply stash@{${pending?.stash.index}} to the working tree.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              variant={pending?.action === "drop" ? "destructive" : "default"}
              size="sm"
              onClick={confirm}
              data-testid="stash-confirm"
            >
              Confirm
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
