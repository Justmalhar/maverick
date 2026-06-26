// Opened by the Projects "+" action: choose a coding agent, a base branch, and a
// branch name (type prefix + slug) for a new workspace's worktree in one flow.
// Defer naming to the AI with "Let AI name it later".
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

export interface NewWorkspacePayload {
  backend: string;
  baseBranch?: string;
  branch?: string;
  aiLater?: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  /** Reserved for Task 2 (base-branch detection). Unused until then. */
  projectPath: string | null;
  onSubmit: (payload: NewWorkspacePayload) => void;
}

export function NewWorkspaceDialog({
  open,
  onOpenChange,
  projectName,
  projectPath,
  onSubmit,
}: Props) {
  // Silence unused-param until Task 2 populates the base-branch selector.
  void projectPath;

  const [type, setType] = useState<BranchType>("feature");
  const [name, setName] = useState("");

  const composed = composeTypedBranch(type, name);
  const canCreate = composed !== "";

  function reset() {
    setType("feature");
    setName("");
  }

  // Placeholder until Task 2 wires the backend selector.
  function backendId(): string {
    return "claude-code";
  }

  // Placeholder until Task 3 wires the base-branch selector.
  function baseBranch(): string | undefined {
    return undefined;
  }

  function create() {
    if (!canCreate) return;
    onOpenChange(false);
    onSubmit({ backend: backendId(), baseBranch: baseBranch(), branch: composed });
    reset();
  }

  function aiLater() {
    onOpenChange(false);
    onSubmit({ backend: backendId(), baseBranch: baseBranch(), aiLater: true });
    reset();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="new-workspace-dialog">
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
          <DialogDescription>
            Set up an isolated worktree for {projectName}.
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
                if (e.key === "Enter") create();
              }}
              placeholder="short description (e.g. login-page)"
              data-testid="branch-name-input"
              className="font-mono text-[12px]"
            />
            <span
              className="font-mono text-[11px] text-muted-foreground"
              data-testid="branch-preview"
            >
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
              onClick={create}
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
