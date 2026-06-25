// Opened by the Projects "+" action: name a new workspace's branch up front
// (branch_type prefix + branch_name → "feature/login-page"), or defer to AI
// which renames the branch later from the work done in the workspace.
import { useState } from "react";
import { Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { composeTypedBranch } from "@/lib/branch-name";
import { cn } from "@/lib/utils";

const BRANCH_TYPES = ["feature", "fix", "bug", "chore", "hotfix"] as const;
type BranchType = (typeof BRANCH_TYPES)[number];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Called with the composed branch (e.g. "feature/login-page") when the user names it.
  onCreate: (branch: string) => void;
  // Called when the user defers naming to the AI (create now, rename later).
  onAiLater: () => void;
}

export function NameWorkspaceDialog({ open, onOpenChange, onCreate, onAiLater }: Props) {
  const [type, setType] = useState<BranchType>("feature");
  const [name, setName] = useState("");

  const composed = composeTypedBranch(type, name);
  const canCreate = composed !== "";

  function reset() {
    setType("feature");
    setName("");
  }

  function submit() {
    if (!canCreate) return;
    onOpenChange(false);
    onCreate(composed);
    reset();
  }

  function aiLater() {
    onOpenChange(false);
    onAiLater();
    reset();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="name-workspace-dialog">
        <DialogHeader>
          <DialogTitle>Name the workspace branch</DialogTitle>
          <DialogDescription>
            Pick a branch type and name, or let the AI name it later from your work.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Branch type</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Branch type">
              {BRANCH_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  aria-pressed={type === t}
                  data-testid={`branch-type-${t}`}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] font-mono transition-colors duration-100",
                    type === t
                      ? "bg-accent text-accent-foreground"
                      : "bg-sidebar-hover text-foreground hover:bg-muted"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Branch name</span>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="short description (e.g. login-page)"
              data-testid="branch-name-input"
              className="font-mono text-[12px]"
            />
            <span className="font-mono text-[11px] text-muted-foreground" data-testid="branch-preview">
              {composed || "feature/…"}
            </span>
          </div>

          <div className="mt-1 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={aiLater}
              data-testid="branch-ai-later"
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] text-accent transition-colors duration-100 hover:bg-sidebar-hover"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Let AI name it later
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canCreate}
              data-testid="branch-create"
              className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-foreground transition-colors duration-100 hover:bg-accent/90 disabled:opacity-50"
            >
              Create workspace
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
