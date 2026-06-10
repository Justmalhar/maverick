import { useState } from "react";
import { GitBranch, Archive, Loader2 } from "lucide-react";
import { useWorkbench } from "@/state/store";
import { useWorkspace } from "@/hooks/useWorkspace";
import { brandFor } from "@/lib/backend-brand";
import { notifySend } from "@/lib/tauri";
import type { Workspace } from "@/lib/ipc";
import { StatusDot } from "@/components/ui/status-dot";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  workspace: Workspace;
}

export function WorkspaceItem({ workspace }: Props) {
  const isActive = useWorkbench((s) => s.activeWorkspaceId === workspace.id);
  const setActiveWorkspace = useWorkbench((s) => s.setActiveWorkspace);
  const { destroy } = useWorkspace();
  const [archiving, setArchiving] = useState(false);

  const label = workspace.title ?? workspace.branch;
  const brand = brandFor(workspace.agentBackend);

  async function onArchive(e: React.MouseEvent) {
    e.stopPropagation();
    if (archiving) return;
    const ok = window.confirm(`Archive workspace "${label}"?`);
    if (!ok) return;
    setArchiving(true);
    try {
      await destroy(workspace.id);
    } catch (err) {
      setArchiving(false);
      const message = err instanceof Error ? err.message : String(err);
      console.error("workspace archive failed", err);
      void notifySend("Archive failed", `${label}: ${message}`, workspace.id, "error").catch(
        () => {}
      );
    }
    // On success the item unmounts with the store row — no state reset needed.
  }

  return (
    <div
      data-testid={`workspace-item-${workspace.id}`}
      data-active={isActive ? "true" : "false"}
      onMouseDown={() => setActiveWorkspace(workspace.id)}
      style={{ height: "22px", paddingLeft: "28px" }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") setActiveWorkspace(workspace.id);
      }}
      className={cn(
        "mv-workspace-item group/ws flex w-full cursor-pointer items-center gap-1.5 pr-2 text-left text-xs",
        "transition-colors duration-100 hover:bg-sidebar-hover",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
        isActive ? "bg-sidebar-selected text-sidebar-selected-fg" : "text-sidebar-fg"
      )}
    >
      <GitBranch className="h-3.5 w-3.5 shrink-0 text-sidebar-fg" />
      <span className="truncate flex-1">{label}</span>
      {/* The backend brand mark yields to the archive action on hover — the
          row is 22px and can't fit both. */}
      <span
        data-testid={`workspace-backend-${workspace.id}`}
        aria-label={brand?.label ?? workspace.agentBackend}
        title={brand?.label ?? workspace.agentBackend}
        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center group-hover/ws:hidden"
      >
        {brand ? (
          <brand.Icon size={12} />
        ) : (
          <span className="text-[10px] text-muted-foreground">{workspace.agentBackend}</span>
        )}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Archive ${label}`}
            data-testid={`workspace-archive-${workspace.id}`}
            disabled={archiving}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => void onArchive(e)}
            className={cn(
              "hidden h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground",
              "transition-colors duration-100 hover:bg-background/40 hover:text-destructive",
              "group-hover/ws:flex",
              archiving && "flex text-muted-foreground"
            )}
          >
            {archiving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Archive className="h-3.5 w-3.5" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Archive workspace</TooltipContent>
      </Tooltip>
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
    </div>
  );
}
