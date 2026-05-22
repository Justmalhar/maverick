import { Draggable } from "@hello-pangea/dnd";
import { formatDistanceToNow } from "date-fns";
import { Eye, GitPullRequest, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWorkbench } from "@/state/store";
import { workspaceCreate } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { DiffStat, KanbanTask } from "@/lib/ipc";

interface Props {
  task: KanbanTask;
  index: number;
  diffStat?: DiffStat;
  onEdit: () => void;
}

const AGENT_DOT: Record<KanbanTask["status"], string> = {
  in_progress: "bg-amber-400",
  review: "bg-emerald-400",
  todo: "bg-muted-foreground/40",
  done: "bg-blue-400/40",
};

export default function KanbanCard({ task, index, diffStat, onEdit }: Props) {
  const addWorkspace = useWorkbench((s) => s.addWorkspace);
  const setActiveWorkspace = useWorkbench((s) => s.setActiveWorkspace);
  const backends = useWorkbench((s) => s.backends);
  const workspaces = useWorkbench((s) => s.workspaces);

  const startInMaverick = async () => {
    const backend =
      task.agentBackend ||
      backends.find((b) => b.active)?.id ||
      backends[0]?.id ||
      "claude";
    try {
      const ws = await workspaceCreate(task.projectId, task.branch || "main", backend);
      addWorkspace(ws);
      setActiveWorkspace(ws.id);
    } catch (e) {
      console.error("Failed to start workspace", e);
    }
  };

  const viewWorkspace = () => {
    const ws = workspaces.find((w) => w.id === task.workspaceId);
    if (ws) setActiveWorkspace(ws.id);
  };

  const ActionButton = () => {
    switch (task.status) {
      case "todo":
        return (
          <Button
            size="sm"
            variant="outline"
            onClick={startInMaverick}
            data-testid="kanban-start"
            className="h-6 gap-1 px-2 text-[11px] border-border/60 text-muted-foreground hover:text-foreground"
          >
            <Play className="h-2.5 w-2.5" />
            Start
          </Button>
        );
      case "in_progress":
        return (
          <Button
            size="sm"
            variant="outline"
            onClick={viewWorkspace}
            data-testid="kanban-view"
            className="h-6 gap-1 px-2 text-[11px] border-border/60 text-muted-foreground hover:text-foreground"
          >
            <Eye className="h-2.5 w-2.5" />
            View
          </Button>
        );
      case "review":
        return (
          <Button
            size="sm"
            variant="outline"
            data-testid="kanban-create-pr"
            className="h-6 gap-1 px-2 text-[11px] border-border/60 text-muted-foreground hover:text-foreground"
          >
            <GitPullRequest className="h-2.5 w-2.5" />
            Create PR
          </Button>
        );
      default:
        return null;
    }
  };

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          data-testid="kanban-card"
          className={cn(
            "rounded-md border border-border/50 bg-card p-3 text-xs transition-all",
            snapshot.isDragging && "shadow-xl ring-1 ring-primary/50 opacity-90"
          )}
        >
          {/* Branch row — branch name + diff stats + status dot */}
          {task.branch && (
            <div className="mb-2 flex items-center gap-1.5">
              <span className="max-w-[140px] truncate font-mono text-[10px] text-muted-foreground/70">
                {task.branch}
              </span>
              {diffStat && (diffStat.added > 0 || diffStat.removed > 0) && (
                <>
                  <span className="text-[10px] font-medium text-emerald-400">
                    +{diffStat.added}
                  </span>
                  <span className="text-[10px] font-medium text-red-400">
                    -{diffStat.removed}
                  </span>
                </>
              )}
              <span
                className={cn("ml-auto h-2 w-2 shrink-0 rounded-full", AGENT_DOT[task.status])}
                data-testid="agent-dot"
              />
            </div>
          )}

          {/* Title + description */}
          <button
            type="button"
            onClick={onEdit}
            className="block w-full text-left"
            data-testid="kanban-card-edit"
          >
            <p className="mb-1 text-[13px] font-semibold leading-snug text-foreground">
              {task.title}
            </p>
            {task.description && (
              <p className="line-clamp-1 text-[11px] leading-relaxed text-muted-foreground/70">
                {task.description.replace(/\*\*/g, "").replace(/#{1,6}\s/g, "")}
              </p>
            )}
          </button>

          {/* Labels */}
          {task.labels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {task.labels.map((l) => (
                <Badge
                  key={l}
                  variant="outline"
                  className="h-4 px-1.5 text-[9px] border-border/50"
                >
                  {l}
                </Badge>
              ))}
            </div>
          )}

          {/* Footer — action button + timestamp */}
          <div className="mt-2.5 flex items-center">
            <ActionButton />
            <span className="ml-auto text-[10px] text-muted-foreground/50">
              {formatDistanceToNow(new Date(task.createdAt * 1000), { addSuffix: true })}
            </span>
          </div>
        </div>
      )}
    </Draggable>
  );
}
