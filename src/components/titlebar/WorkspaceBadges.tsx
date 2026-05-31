import { GitBranch } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useWorkbench } from "@/state/store";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Workspace } from "@/lib/ipc";

// Per-status dot color. Maps to semantic tokens only.
const STATUS_DOT: Record<Workspace["status"], string> = {
  active: "bg-success",
  idle: "bg-muted-foreground",
  error: "bg-destructive",
};

const STATUS_LABEL: Record<Workspace["status"], string> = {
  active: "Active",
  idle: "Idle",
  error: "Error",
};

interface BadgeProps {
  workspace: Workspace;
  active: boolean;
  onSelect: () => void;
}

function WorkspaceBadge({ workspace, active, onSelect }: BadgeProps) {
  const label = workspace.title ?? workspace.branch;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onSelect}
          data-testid={`workspace-badge-${workspace.id}`}
          aria-pressed={active}
          aria-current={active ? "true" : undefined}
          className={cn(
            "no-drag flex h-6 max-w-[160px] items-center gap-1.5 rounded-md border border-border px-2 text-[11px] transition-colors duration-100",
            active
              ? "bg-accent/20 text-foreground"
              : "bg-activitybar/60 text-muted-foreground hover:bg-sidebar-hover hover:text-foreground",
          )}
        >
          <span
            data-testid={`workspace-badge-status-${workspace.id}`}
            className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[workspace.status])}
          />
          <GitBranch className="h-3 w-3 shrink-0 opacity-70" />
          <span className="truncate">{label}</span>
          <span className="shrink-0 rounded-sm bg-background/60 px-1 text-[9px] uppercase tracking-wide text-muted-foreground">
            {workspace.agentBackend}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label} · {workspace.agentBackend} · {STATUS_LABEL[workspace.status]}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Compact per-workspace badges shown in the TitleBar — branch + a status dot
 * and backend indicator for each open workspace. Clicking a badge activates
 * that workspace. Hidden entirely when no workspaces are open.
 */
export function WorkspaceBadges() {
  const workspaces = useWorkbench((s) => s.workspaces);
  const activeId = useWorkbench((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useWorkbench((s) => s.setActiveWorkspace);
  const reduceMotion = useReducedMotion();

  if (workspaces.length === 0) return null;

  return (
    <motion.div
      data-testid="workspace-badges"
      initial={reduceMotion ? false : { opacity: 0, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="no-drag flex items-center gap-1 overflow-x-auto"
    >
      {workspaces.map((ws) => (
        <WorkspaceBadge
          key={ws.id}
          workspace={ws}
          active={ws.id === activeId}
          onSelect={() => setActiveWorkspace(ws.id)}
        />
      ))}
    </motion.div>
  );
}

export const __testing__ = { STATUS_DOT, STATUS_LABEL };
