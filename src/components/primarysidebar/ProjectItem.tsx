import { useState } from "react";
import { ChevronRight, Settings2, Link2, Plus } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useWorkbench } from "@/state/store";
import type { Project } from "@/lib/ipc";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { WorkspaceItem } from "./WorkspaceItem";

interface Props {
  project: Project;
  onAddWorkspace?: (projectId: string) => void;
  onSettings?: (projectId: string) => void;
  onCreateFrom?: (projectId: string) => void;
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Settings2;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          aria-label={label}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-all duration-100 group-hover/row:opacity-100 hover:bg-background/40 hover:text-foreground"
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function ProjectItem({ project, onAddWorkspace, onSettings, onCreateFrom }: Props) {
  const [expanded, setExpanded] = useState(true);
  const workspaces = useWorkbench(
    useShallow((s) => s.workspaces.filter((w) => w.projectId === project.id))
  );

  return (
    <div className="mv-project-item" data-testid={`project-item-${project.id}`}>
      <div
        className="group/row flex items-center gap-0.5 pr-1 transition-colors duration-100 hover:bg-sidebar-hover"
        style={{ height: "26px" }}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex h-full min-w-0 flex-1 items-center gap-1 pl-2 pr-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 text-sidebar-fg transition-transform duration-100",
              expanded && "rotate-90"
            )}
          />
          <span className="truncate text-xs font-medium text-foreground">{project.name}</span>
        </button>

        <div className="flex items-center gap-0.5">
          <ActionButton
            icon={Settings2}
            label="Project settings"
            onClick={() => onSettings?.(project.id)}
          />
          <ActionButton
            icon={Link2}
            label="Create from"
            onClick={() => onCreateFrom?.(project.id)}
          />
          <ActionButton
            icon={Plus}
            label="New workspace"
            onClick={() => onAddWorkspace?.(project.id)}
          />
        </div>
      </div>

      {expanded && (
        <ul className="overflow-hidden">
          {workspaces.length === 0 ? (
            <li
              className="flex items-center pl-6 text-xs text-muted-foreground"
              style={{ height: "22px" }}
            >
              No workspaces
            </li>
          ) : (
            workspaces.map((ws) => (
              <li key={ws.id}>
                <WorkspaceItem workspace={ws} />
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
