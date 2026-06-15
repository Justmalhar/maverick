import { useState } from "react";
import { ChevronRight, Copy, Save, Undo2 } from "lucide-react";
import { useWorkbench, type FileTab } from "@/state/store";
import type { ViewerActions, ViewerDescriptor } from "@/lib/viewers/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface Props {
  tab: FileTab;
  actions: ViewerActions;
  candidates: ViewerDescriptor[];
}

function relSegments(tab: FileTab): string[] {
  const rel = tab.path.startsWith(tab.worktreePath)
    ? tab.path.slice(tab.worktreePath.length).replace(/^\//, "")
    : tab.path;
  return rel.split("/").filter(Boolean);
}

export function ViewerToolbar({ tab, actions, candidates }: Props) {
  const live = useWorkbench((s) => s.fileTabs.find((t) => t.id === tab.id)) ?? tab;
  const setFileTabMode = useWorkbench((s) => s.setFileTabMode);
  const setFileTabViewer = useWorkbench((s) => s.setFileTabViewer);
  const setFileTabViewed = useWorkbench((s) => s.setFileTabViewed);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const segments = relSegments(live);
  // Show the Diff/Edit switcher for diff tabs; show a View/Edit switcher for
  // markdown file tabs (detected by candidates[0]?.id === "markdown").
  const showDiffSwitch = live.kind === "diff";
  const showMarkdownSwitch = !showDiffSwitch && candidates[0]?.id === "markdown";
  const showModeSwitch = showDiffSwitch || showMarkdownSwitch;

  return (
    <div
      data-testid="viewer-toolbar"
      className="mv-viewertoolbar flex h-8 shrink-0 items-center gap-2 border-b border-border bg-background px-2"
    >
      <nav aria-label="File path" className="flex min-w-0 flex-1 items-center gap-0.5 text-[11px] text-muted-foreground">
        {segments.map((seg, i) => (
          <span key={`${seg}-${i}`} className="flex items-center gap-0.5">
            {i > 0 && <ChevronRight className="h-3 w-3 opacity-50" />}
            <span className={cn("truncate", i === segments.length - 1 && "text-foreground")}>{seg}</span>
          </span>
        ))}
      </nav>

      {showDiffSwitch && (
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            aria-label="Viewed"
            checked={live.viewed}
            onChange={(e) => setFileTabViewed(live.id, e.target.checked)}
            className="h-3 w-3 accent-accent"
          />
          Viewed
        </label>
      )}


      {live.dirty && actions.save && (
        <Button variant="ghost" size="sm" aria-label="Save" onClick={() => void actions.save?.()}>
          <Save className="h-3.5 w-3.5" />
          Save
        </Button>
      )}

      {actions.discardChanges && (
        <Button variant="ghost" size="sm" aria-label="Undo changes" onClick={() => setConfirmDiscard(true)}>
          <Undo2 className="h-3.5 w-3.5" />
          Undo changes
        </Button>
      )}

      {actions.copyContents && (
        <Button variant="ghost" size="sm" aria-label="Copy contents" onClick={() => void actions.copyContents?.()}>
          <Copy className="h-3.5 w-3.5" />
        </Button>
      )}

      {showModeSwitch && (
        <div role="group" aria-label="View mode" className="flex overflow-hidden rounded-md border border-border">
          {showDiffSwitch
            ? (["diff", "edit"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-label={m === "diff" ? "Diff" : "Edit"}
                  onClick={() => setFileTabMode(live.id, m)}
                  className={cn(
                    "px-2 py-0.5 text-[11px] capitalize transition-colors duration-100",
                    live.mode === m ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-foreground/5"
                  )}
                >
                  {m === "diff" ? "Diff" : "Edit"}
                </button>
              ))
            : (["view", "edit"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-label={m === "view" ? "View" : "Edit"}
                  onClick={() => setFileTabMode(live.id, m)}
                  className={cn(
                    "px-2 py-0.5 text-[11px] capitalize transition-colors duration-100",
                    live.mode === m ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-foreground/5"
                  )}
                >
                  {m === "view" ? "View" : "Edit"}
                </button>
              ))}
        </div>
      )}

      {candidates.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" aria-label="Open with">
              Open With…
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {candidates.map((d) => (
              <DropdownMenuItem key={d.id} onClick={() => setFileTabViewer(live.id, d.id)}>
                {d.displayName}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Undo changes</DialogTitle>
            <DialogDescription>
              Discard all working-tree changes to {segments[segments.length - 1]}? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmDiscard(false);
                void actions.discardChanges?.();
              }}
            >
              Discard
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
