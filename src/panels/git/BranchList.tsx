// Tree of local + remote branches with checkout action.
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GitBranch as GitBranchIcon, Cloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Props {
  worktreePath: string;
}

interface Branch {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
}

export default function BranchList({ worktreePath }: Props) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!worktreePath) return;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<Branch[]>("git_branch_list", { worktreePath });
      setBranches(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [worktreePath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const checkout = useCallback(
    async (branch: Branch) => {
      try {
        setBusy(branch.name);
        await invoke("git_checkout", { worktreePath, branch: branch.name });
        await refresh();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(null);
      }
    },
    [worktreePath, refresh]
  );

  const { local, remote } = useMemo(() => {
    const q = query.toLowerCase();
    const filtered = branches.filter((b) => b.name.toLowerCase().includes(q));
    return {
      local: filtered.filter((b) => !b.isRemote),
      remote: filtered.filter((b) => b.isRemote),
    };
  }, [branches, query]);

  return (
    <div data-testid="branch-list" className="flex h-full w-full flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <Input
          data-testid="branch-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search branches…"
          className="flex-1"
        />
        <Button size="sm" variant="ghost" onClick={refresh}>
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
        <BranchGroup title="Local" icon={<GitBranchIcon className="h-3 w-3" />}>
          {local.map((b) => (
            <BranchRow
              key={b.name}
              branch={b}
              busy={busy === b.name}
              onCheckout={() => checkout(b)}
            />
          ))}
        </BranchGroup>
        <BranchGroup title="Remote" icon={<Cloud className="h-3 w-3" />}>
          {remote.map((b) => (
            <BranchRow
              key={b.name}
              branch={b}
              busy={busy === b.name}
              onCheckout={() => checkout(b)}
            />
          ))}
        </BranchGroup>
      </ScrollArea>
    </div>
  );
}

function BranchGroup({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border/40">
      <div className="flex items-center gap-1.5 bg-muted/30 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function BranchRow({
  branch,
  busy,
  onCheckout,
}: {
  branch: Branch;
  busy: boolean;
  onCheckout: () => void;
}) {
  return (
    <div
      data-testid="branch-row"
      className={cn(
        "flex items-center gap-2 border-b border-border/30 px-3 py-1 text-xs",
        branch.isCurrent && "bg-primary/10"
      )}
    >
      <GitBranchIcon
        className={cn(
          "h-3 w-3",
          branch.isCurrent ? "text-primary" : "text-muted-foreground"
        )}
      />
      <span className="flex-1 truncate font-mono text-[11px]">{branch.name}</span>
      {branch.ahead !== undefined && branch.ahead > 0 && (
        <span className="text-[10px] text-success">↑{branch.ahead}</span>
      )}
      {branch.behind !== undefined && branch.behind > 0 && (
        <span className="text-[10px] text-warning">↓{branch.behind}</span>
      )}
      {!branch.isCurrent && (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={onCheckout}
          data-testid="branch-checkout"
        >
          Checkout
        </Button>
      )}
    </div>
  );
}
