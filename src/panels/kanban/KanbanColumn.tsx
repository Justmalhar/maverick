import React from "react";
import { Droppable } from "@hello-pangea/dnd";
import { CheckCircle2, Clock, Eye, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DiffStat, KanbanTask } from "@/lib/ipc";
import KanbanCard from "./KanbanCard";

interface Props {
  status: KanbanTask["status"];
  tasks: KanbanTask[];
  diffStatCache: Map<string, DiffStat>;
  onEdit: (task: KanbanTask) => void;
}

const LABELS: Record<KanbanTask["status"], string> = {
  todo: "Todo",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

const STATUS_ICON: Record<KanbanTask["status"], React.ReactNode> = {
  todo: <Clock className="h-3.5 w-3.5 text-muted-foreground" />,
  in_progress: <Zap className="h-3.5 w-3.5 text-amber-400" />,
  review: <Eye className="h-3.5 w-3.5 text-emerald-400" />,
  done: <CheckCircle2 className="h-3.5 w-3.5 text-blue-400" />,
};

export default function KanbanColumn({ status, tasks, diffStatCache, onEdit }: Props) {
  return (
    <div
      data-testid={`kanban-column-${status}`}
      className="flex w-72 shrink-0 flex-col rounded-md border border-border bg-card/40"
    >
      <div
        className="flex items-center gap-2 px-3 py-2.5"
        style={{ borderBottom: "1px solid hsl(var(--border))" }}
      >
        {STATUS_ICON[status]}
        <span className="text-xs font-medium text-foreground/80">{LABELS[status]}</span>
        <span className="ml-0.5 text-xs text-muted-foreground">{tasks.length}</span>
      </div>
      <Droppable droppableId={status}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn(
              "flex-1 space-y-1.5 px-2 pb-2 transition-colors",
              snapshot.isDraggingOver && "bg-accent/5"
            )}
          >
            {tasks.map((task, index) => (
              <KanbanCard
                key={task.id}
                task={task}
                index={index}
                diffStat={task.workspaceId ? diffStatCache.get(task.workspaceId) : undefined}
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
