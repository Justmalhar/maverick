import { ChevronRight, GitBranch } from "lucide-react";
import { useWorkbench, selectActiveWorkspace } from "@/state/store";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

export function Breadcrumb({ className }: Props) {
  const active = useWorkbench(selectActiveWorkspace);
  const project = useWorkbench((s) =>
    active ? s.projects.find((p) => p.id === active.projectId) : null
  );

  if (!active) {
    return (
      <div
        data-testid="breadcrumb-empty"
        className={cn(
          "flex items-center text-[13px] font-normal text-muted-foreground",
          className
        )}
      >
        Maverick
      </div>
    );
  }

  return (
    <div
      data-testid="breadcrumb"
      className={cn(
        "flex max-w-full items-center gap-1.5 text-[12px] text-muted-foreground",
        className
      )}
    >
      <span className="truncate text-foreground">{project?.name ?? "Project"}</span>
      <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />
      <GitBranch className="h-3 w-3 shrink-0" />
      <span className="truncate text-foreground">{active.branch}</span>
      <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />
      <span className="truncate">{active.agentBackend}</span>
    </div>
  );
}
