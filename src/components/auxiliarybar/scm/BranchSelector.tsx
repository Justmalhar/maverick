import { useEffect, useState } from "react";
import { Check, ChevronDown, GitBranch } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { gitBranchList, gitCheckout } from "@/lib/tauri";
import type { Branch } from "@/lib/ipc";
import { cn } from "@/lib/utils";

export function BranchSelector({
  worktreePath,
  currentName,
  ahead,
  behind,
  onChanged,
}: {
  worktreePath: string;
  currentName: string;
  ahead: number;
  behind: number;
  onChanged: () => void;
}) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    gitBranchList(worktreePath)
      .then((b) => setBranches(b.filter((x) => !x.isRemote)))
      .catch(() => setBranches([]));
  }, [open, worktreePath]);

  async function checkout(name: string) {
    setOpen(false);
    if (name === currentName) return;
    await gitCheckout(worktreePath, name).catch(() => {});
    onChanged();
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="scm-branch-selector"
          className="flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 text-xs text-foreground transition-colors duration-100 hover:bg-sidebar-hover"
        >
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-sidebar-fg" />
          <span className="truncate font-medium" data-testid="scm-branch">{currentName}</span>
          {ahead > 0 && <span className="text-[10px] text-success" data-testid="scm-ahead">↑{ahead}</span>}
          {behind > 0 && <span className="text-[10px] text-warning" data-testid="scm-behind">↓{behind}</span>}
          <ChevronDown className="h-3 w-3 shrink-0 text-sidebar-fg" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-auto">
        {branches.map((b) => (
          <DropdownMenuItem
            key={b.name}
            data-testid={`scm-branch-item-${b.name}`}
            onSelect={() => void checkout(b.name)}
            className="text-xs"
          >
            <Check className={cn("mr-2 h-3 w-3", b.name === currentName ? "opacity-100" : "opacity-0")} />
            <span className="truncate">{b.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
