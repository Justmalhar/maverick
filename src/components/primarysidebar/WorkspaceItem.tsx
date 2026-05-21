import { GitBranch } from "lucide-react";
import { useWorkbench } from "@/state/store";
import type { Workspace } from "@/lib/ipc";
import { StatusDot } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";

interface Props {
  workspace: Workspace;
}

export function WorkspaceItem({ workspace }: Props) {
  const isActive = useWorkbench((s) => s.activeWorkspaceId === workspace.id);
  const setActiveWorkspace = useWorkbench((s) => s.setActiveWorkspace);

  return (
    <button
      type="button"
      data-testid={`workspace-item-${workspace.id}`}
      data-active={isActive ? "true" : "false"}
      onClick={() => setActiveWorkspace(workspace.id)}
      style={{ height: "22px", paddingLeft: "28px" }}
      className={cn(
        "mv-workspace-item flex w-full items-center gap-1.5 pr-2 text-left text-xs",
        "transition-colors duration-100 hover:bg-sidebar-hover",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
        isActive ? "bg-sidebar-selected text-sidebar-selected-fg" : "text-sidebar-fg"
      )}
    >
      <GitBranch className="h-3.5 w-3.5 shrink-0 text-sidebar-fg" />
      <span className="truncate flex-1">
        {workspace.title ?? workspace.branch}
      </span>
      <span className="text-[10px] text-muted-foreground">
        {workspace.agentBackend}
      </span>
      <StatusDot
        variant={
          workspace.status === "active"
            ? "active"
            : workspace.status === "error"
              ? "error"
              : "idle"
        }
        size="sm"
      />
    </button>
  );
}
