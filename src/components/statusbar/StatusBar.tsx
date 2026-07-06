// Bottom status bar — token usage, git status, backend status, notifications.
import { useMemo } from "react";
import { GitBranch, Cpu } from "lucide-react";
import { useWorkbench } from "@/state/store";
import { useContextUsage } from "@/hooks/useContextUsage";
import { useAgentStatus } from "@/hooks/useAgentStatus";
import { cn } from "@/lib/utils";

function StatusBarItem({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon: typeof GitBranch;
  label: string;
  value?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2 py-0.5 text-[11px] text-muted-foreground",
        className
      )}
      title={`${label}${value ? `: ${value}` : ""}`}
    >
      <Icon className="h-3 w-3" />
      {value && <span className="truncate">{value}</span>}
    </div>
  );
}

export function StatusBar() {
  const activeWorkspaceId = useWorkbench((s) => s.activeWorkspaceId);
  const workspaces = useWorkbench((s) => s.workspaces);
  const backends = useWorkbench((s) => s.backends);
  const agentStatus = useAgentStatus(activeWorkspaceId ?? "");

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId),
    [workspaces, activeWorkspaceId]
  );

  const activeBackend = useMemo(
    () => backends.find((b) => b.active),
    [backends]
  );

  // Get context usage for the active workspace's session
  const sessionId = activeWorkspace?.sessionId;
  const usage = useContextUsage(sessionId);

  const tokenDisplay = usage.tokensUsed > 0
    ? `${Math.round(usage.tokensUsed / 1000)}k / ${Math.round(usage.contextWindow / 1000)}k`
    : null;

  const costDisplay = usage.sessionCostEstimate > 0
    ? `$${usage.sessionCostEstimate.toFixed(2)}`
    : null;

  return (
    <footer
      data-testid="statusbar"
      className="glass-light flex h-6 w-full shrink-0 items-center justify-between border-t border-border-glass px-2"
    >
      <div className="flex items-center">
        {activeWorkspace && (
          <>
            <StatusBarItem
              icon={GitBranch}
              label="Branch"
              value={activeWorkspace.branch}
            />
            {tokenDisplay && (
              <StatusBarItem
                icon={Cpu}
                label="Tokens"
                value={tokenDisplay}
              />
            )}
            {costDisplay && (
              <StatusBarItem
                icon={Cpu}
                label="Cost"
                value={costDisplay}
              />
            )}
          </>
        )}
      </div>

      <div className="flex items-center">
        {activeBackend && (
          <StatusBarItem
            icon={Cpu}
            label="Backend"
            value={activeBackend.id}
          />
        )}
        {agentStatus !== "idle" && (
          <StatusBarItem
            icon={Cpu}
            label="Status"
            value={agentStatus}
            className={cn(
              agentStatus === "working" && "text-info",
              agentStatus === "done" && "text-success",
              agentStatus === "error" && "text-destructive"
            )}
          />
        )}
      </div>
    </footer>
  );
}
