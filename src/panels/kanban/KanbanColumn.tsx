// Kanban column — droppable target, header with task count.
import { Droppable } from "@hello-pangea/dnd";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { KanbanTask } from "@/lib/ipc";
import KanbanCard from "./KanbanCard";

interface Props {
  status: KanbanTask["status"];
  tasks: KanbanTask[];
  onEdit: (task: KanbanTask) => void;
}

const LABELS: Record<KanbanTask["status"], string> = {
  backlog: "Backlog",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

export default function KanbanColumn({ status, tasks, onEdit }: Props) {
  return (
    <div
      data-testid={`kanban-column-${status}`}
      className="flex w-72 shrink-0 flex-col rounded-md border border-border bg-card/30"
    >
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {LABELS[status]}
        </span>
        <Badge variant="outline">{tasks.length}</Badge>
      </div>
      <Droppable droppableId={status}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn(
              "flex-1 space-y-1.5 p-1.5 transition-colors",
              snapshot.isDraggingOver && "bg-accent/10"
            )}
          >
            {tasks.map((task, index) => (
              <KanbanCard
                key={task.id}
                task={task}
                index={index}
                onEdit={() => onEdit(task)}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}
