// Branch picker behind the project-row "Create from" action: choose the base
// branch a new workspace's worktree is created from.
import { useEffect, useMemo, useState } from "react";
import { GitBranch, Cloud } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { gitBranchList } from "@/lib/tauri";
import type { Branch } from "@/lib/ipc";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectPath: string | null;
  onSelect: (baseBranch: string) => void;
}

export function CreateFromDialog({ open, onOpenChange, projectPath, onSelect }: Props) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open || !projectPath) return;
    let cancelled = false;
    gitBranchList(projectPath)
      .then((list) => {
        if (!cancelled) setBranches(list);
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectPath]);

  const filtered = useMemo(() => {
    if (!query) return branches;
    const q = query.toLowerCase();
    return branches.filter((b) => b.name.toLowerCase().includes(q));
  }, [branches, query]);

  function choose(branch: Branch) {
    onOpenChange(false);
    setQuery("");
    onSelect(branch.name);
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Create workspace from branch…"
        value={query}
        onValueChange={setQuery}
        data-testid="create-from-input"
      />
      <CommandList data-testid="create-from-list">
        <CommandEmpty>No branches found</CommandEmpty>
        {filtered.map((b) => (
          <CommandItem
            key={`${b.isRemote ? "r" : "l"}-${b.name}`}
            value={b.name}
            onSelect={() => choose(b)}
            data-testid={`create-from-branch-${b.name}`}
            className="gap-2"
          >
            {b.isRemote ? (
              <Cloud className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="flex-1 truncate">{b.name}</span>
            {b.isCurrent && (
              <span className="text-[10px] text-muted-foreground">current</span>
            )}
          </CommandItem>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
