// Opened by the Projects "+" action: choose a coding agent, a base branch, and a
// branch name (type prefix + slug) for a new workspace's worktree in one flow.
// Defer naming to the AI with "Let AI name it later".
import { useState, useEffect } from "react";
import { Sparkles, GitBranch } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
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

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}

export function NewWorkspaceDialog({
  open,
  onOpenChange,
  projectName,
  projectPath,
  onSubmit,
}: Props) {
  const reduceMotion = useReducedMotion();
  const backends = useWorkbench((s) => s.backends);
  const [backend, setBackend] = useState(
    () => backends.find((b) => b.active)?.id ?? backends[0]?.id ?? "claude-code"
  );

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

  useEffect(() => {
    if (!open) {
      setType("feature");
      setName("");
      return;
    }
    setBackend(backends.find((b) => b.active)?.id ?? backends[0]?.id ?? "claude-code");
  }, [open, backends]);

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
      <DialogContent className="max-w-md gap-0 p-0" data-testid="new-workspace-dialog">
        <DialogHeader className="space-y-1 border-b border-border px-6 py-5">
          <DialogTitle className="text-base">New workspace</DialogTitle>
          <DialogDescription>
            Set up an isolated worktree for {projectName}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 px-6 py-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <FieldLabel>Coding agent</FieldLabel>
              <Select value={backend} onValueChange={setBackend} disabled={backends.length === 0}>
                <SelectTrigger className="h-9 w-full text-[12px]" data-testid="agent-select">
                  {backends.length === 0 ? (
                    <span className="text-muted-foreground">No agents detected</span>
                  ) : (
                    <SelectValue placeholder={brandFor(backend)?.label ?? backend} />
                  )}
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
              <FieldLabel>Base branch</FieldLabel>
              <Select value={base} onValueChange={setBase} disabled={branches.length === 0}>
                <SelectTrigger className="h-9 w-full text-[12px]" data-testid="base-branch-select">
                  <span className="flex items-center gap-2 overflow-hidden">
                    <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <SelectValue placeholder={projectPath ? "Default branch" : "—"} />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem
                      key={`${b.isRemote ? "r" : "l"}-${b.name}`}
                      value={b.name}
                      className="text-[12px]"
                    >
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
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel>Branch type</FieldLabel>
            <div
              className="grid grid-cols-5 gap-1 rounded-md border border-border bg-card p-1"
              role="group"
              aria-label="Branch type"
            >
              {BRANCH_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  aria-pressed={type === t}
                  data-testid={`branch-type-${t}`}
                  className={cn(
                    "relative rounded px-1 py-1.5 text-[11px] font-mono transition-colors duration-100",
                    type === t
                      ? "text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {type === t ? (
                    <motion.span
                      layoutId="branch-type-active"
                      className="absolute inset-0 rounded bg-accent shadow-sm"
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : { type: "spring", stiffness: 380, damping: 30 }
                      }
                    />
                  ) : null}
                  <span className="relative z-10">{t}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel>Branch name</FieldLabel>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") create();
              }}
              placeholder="short description (e.g. login-page)"
              data-testid="branch-name-input"
              className="h-9 font-mono text-[12px]"
            />
            <span
              className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground"
              data-testid="branch-preview"
            >
              <GitBranch className="h-3 w-3 shrink-0" />
              {composed || `${type}/…`}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={aiLater}
            data-testid="branch-ai-later"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Let AI name it later
          </button>
          <button
            type="button"
            onClick={create}
            disabled={!canCreate}
            data-testid="branch-create"
            className="rounded-md bg-accent px-3.5 py-1.5 text-[12px] font-medium text-accent-foreground transition-colors duration-100 hover:bg-accent/90 disabled:opacity-40"
          >
            Create workspace
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
