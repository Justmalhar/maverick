// Opened by the Projects "+" action: choose a coding agent, a base branch, and a
// branch name (type prefix + slug) for a new workspace's worktree in one flow.
// Defer naming to the AI with "Let AI name it later".
import { useState, useEffect } from "react";
import { Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { composeTypedBranch } from "@/lib/branch-name";
import { cn } from "@/lib/utils";
import { useWorkbench } from "@/state/store";
import { brandFor } from "@/lib/backend-brand";
import { gitBranchList } from "@/lib/tauri";
import type { Branch } from "@/lib/ipc";

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
  const backends = useWorkbench((s) => s.backends);
  const [backend, setBackend] = useState(
    () => backends.find((b) => b.active)?.id ?? backends[0]?.id ?? "claude-code"
  );
  const selectedBrand = brandFor(backend);
  const SelectedIcon = selectedBrand?.Icon;

  const [branches, setBranches] = useState<Branch[]>([]);
  const [base, setBase] = useState<string>("");

  useEffect(() => {
    if (!open || !projectPath) {
      setBranches([]);
      setBase("");
      return;
    }
    let cancelled = false;
    gitBranchList(projectPath)
      .then((list) => {
        if (cancelled) return;
        setBranches(list);
        setBase(list.find((b) => b.isCurrent)?.name ?? "");
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectPath]);

  const [type, setType] = useState<BranchType>("feature");
  const [name, setName] = useState("");

  const composed = composeTypedBranch(type, name);
  const canCreate = composed !== "";

  function reset() {
    setType("feature");
    setName("");
    setBase("");
    setBranches([]);
  }

  function create() {
    if (!canCreate) return;
    onOpenChange(false);
    onSubmit({ backend, baseBranch: base || undefined, branch: composed });
    reset();
  }

  function aiLater() {
    onOpenChange(false);
    onSubmit({ backend, baseBranch: base || undefined, aiLater: true });
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
            <span className="text-[11px] font-medium text-muted-foreground">Coding agent</span>
            <Select value={backend} onValueChange={setBackend} disabled={backends.length === 0}>
              <SelectTrigger className="h-8 text-[12px]" data-testid="agent-select">
                {SelectedIcon ? <SelectedIcon size={14} /> : null}
                <SelectValue placeholder={selectedBrand?.label ?? backend} />
              </SelectTrigger>
              <SelectContent>
                {backends.map((b) => {
                  const brand = brandFor(b.id);
                  const BrandIcon = brand?.Icon;
                  return (
                    <SelectItem key={b.id} value={b.id} className="text-[12px]">
                      <span className="flex items-center gap-2">
                        {BrandIcon ? <BrandIcon size={14} /> : null}
                        {brand?.label ?? b.name}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Base branch</span>
            <Select value={base} onValueChange={setBase} disabled={branches.length === 0}>
              <SelectTrigger className="h-8 text-[12px]" data-testid="base-branch-select">
                <SelectValue placeholder={projectPath ? "Default branch" : "—"} />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={`${b.isRemote ? "r" : "l"}-${b.name}`} value={b.name} className="text-[12px]">
                    <span className="flex items-center gap-2">
                      {b.name}
                      {b.isCurrent ? (
                        <span className="text-[10px] text-muted-foreground">current</span>
                      ) : null}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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
