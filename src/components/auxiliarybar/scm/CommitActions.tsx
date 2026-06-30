import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  GitBranchPlus,
  GitCommitVertical,
  GitPullRequest,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface CommitActionsProps {
  primaryLabel: "Commit" | "Commit & Push";
  canCommit: boolean;
  busy: boolean;
  anyBusy: boolean;
  canAgentPr: boolean;
  onCommit: () => void;
  onCommitAndPush: () => void;
  onPull: () => void;
  onPush: () => void;
  onSync: () => void;
  onCreatePr: () => void;
  onCreatePrWithAgent: () => void;
  onCreateBranch: () => void;
}

export function CommitActions(props: CommitActionsProps) {
  const primary = props.primaryLabel === "Commit & Push" ? props.onCommitAndPush : props.onCommit;
  return (
    <div className="flex">
      <button
        type="button"
        data-testid="scm-primary"
        onClick={primary}
        disabled={!props.canCommit || props.busy}
        className="flex flex-1 items-center justify-center gap-1.5 rounded-l-md bg-accent px-2 py-1.5 text-[11px] font-medium text-accent-foreground transition-colors duration-100 hover:bg-accent/90 disabled:opacity-60"
      >
        {props.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCommitVertical className="h-3.5 w-3.5" />}
        {props.primaryLabel}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="scm-actions-trigger"
            aria-label="Git actions"
            className="flex items-center justify-center rounded-r-md border-l border-accent-foreground/20 bg-accent px-1.5 py-1.5 text-accent-foreground transition-colors duration-100 hover:bg-accent/90"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Git actions</DropdownMenuLabel>
          <DropdownMenuItem data-testid="scm-action-commit" disabled={props.anyBusy} onSelect={props.onCommit} className="text-xs">
            <GitCommitVertical className="mr-2 h-3.5 w-3.5" /> Commit
          </DropdownMenuItem>
          <DropdownMenuItem data-testid="scm-action-pull" disabled={props.anyBusy} onSelect={props.onPull} className="text-xs">
            <ArrowDownToLine className="mr-2 h-3.5 w-3.5" /> Pull
          </DropdownMenuItem>
          <DropdownMenuItem data-testid="scm-action-push" disabled={props.anyBusy} onSelect={props.onPush} className="text-xs">
            <ArrowUpFromLine className="mr-2 h-3.5 w-3.5" /> Push
          </DropdownMenuItem>
          <DropdownMenuItem data-testid="scm-action-sync" disabled={props.anyBusy} onSelect={props.onSync} className="text-xs">
            <RefreshCw className="mr-2 h-3.5 w-3.5" /> Sync
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Pull request</DropdownMenuLabel>
          <DropdownMenuItem data-testid="scm-action-pr-direct" disabled={props.anyBusy} onSelect={props.onCreatePr} className="text-xs">
            <GitPullRequest className="mr-2 h-3.5 w-3.5" /> Create PR
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="scm-action-pr-agent"
            disabled={!props.canAgentPr || props.anyBusy}
            onSelect={() => props.canAgentPr && !props.anyBusy && props.onCreatePrWithAgent()}
            className="text-xs"
          >
            <GitPullRequest className="mr-2 h-3.5 w-3.5" /> Create PR with Agent
          </DropdownMenuItem>
          <DropdownMenuItem data-testid="scm-action-branch" disabled={props.anyBusy} onSelect={props.onCreateBranch} className="text-xs">
            <GitBranchPlus className="mr-2 h-3.5 w-3.5" /> Create Branch
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
