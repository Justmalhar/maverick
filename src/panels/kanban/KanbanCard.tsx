// Kanban card — draggable, markdown description preview, "Start in Maverick".
import { Draggable } from "@hello-pangea/dnd";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatDistanceToNow } from "date-fns";
import { Calendar, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWorkbench } from "@/state/store";
import { workspaceCreate } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { KanbanTask } from "@/lib/ipc";

interface Props {
  task: KanbanTask;
  index: number;
  onEdit: () => void;
}

export default function KanbanCard({ task, index, onEdit }: Props) {
  const addWorkspace = useWorkbench((s) => s.addWorkspace);
  const setActiveWorkspace = useWorkbench((s) => s.setActiveWorkspace);
  const backends = useWorkbench((s) => s.backends);

  const startInMaverick = async () => {
    const defaultBackend = backends.find((b) => b.active)?.id ?? backends[0]?.id ?? "claude";
    try {
      const ws = await workspaceCreate(task.projectId, "main", defaultBackend);
      addWorkspace(ws);
      setActiveWorkspace(ws.id);
    } catch (e) {
      // Surface via console for v0.1; toast wiring lives in store consumer.
      console.error("Failed to start workspace", e);
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
            "group rounded-sm border border-border bg-card p-2 text-xs transition-shadow",
            snapshot.isDragging && "shadow-lg ring-1 ring-primary"
          )}
        >
          <button
            type="button"
            onClick={onEdit}
            className="block w-full text-left"
            data-testid="kanban-card-edit"
          >
            <h4 className="mb-1 font-medium text-foreground">{task.title}</h4>
            {task.description && (
              <div className="prose-xs line-clamp-3 text-[11px] text-muted-foreground">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {task.description}
                </ReactMarkdown>
              </div>
            )}
          </button>
          {task.labels.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {task.labels.map((l) => (
                <Badge key={l} variant="outline">
                  {l}
                </Badge>
              ))}
            </div>
          )}
          <div className="mt-1.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              {task.dueDate && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-2.5 w-2.5" />
                  {formatDistanceToNow(new Date(task.dueDate * 1000), {
                    addSuffix: true,
                  })}
                </span>
              )}
              {task.workspaceId && (
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={startInMaverick}
              data-testid="kanban-start"
              className="h-5 px-1.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100"
            >
              <Play className="h-2.5 w-2.5" />
              Start
            </Button>
          </div>
        </div>
      )}
    </Draggable>
  );
}
