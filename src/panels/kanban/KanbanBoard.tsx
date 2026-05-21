// ⌘⇧K — per-project Kanban board, drag-drop, "Start in Maverick".
import { useCallback, useEffect, useMemo, useState } from "react";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { motion, useReducedMotion } from "framer-motion";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkbench } from "@/state/store";
import { kanbanList, kanbanUpsert } from "@/lib/tauri";
import type { KanbanTask } from "@/lib/ipc";
import KanbanColumn from "./KanbanColumn";
import KanbanTaskDialog from "./KanbanTaskDialog";

const DEFAULT_COLUMNS: KanbanTask["status"][] = [
  "backlog",
  "in_progress",
  "review",
  "done",
];

export default function KanbanBoard() {
  const activeWorkspace = useWorkbench((s) =>
    s.workspaces.find((w) => w.id === s.activeWorkspaceId)
  );
  const projectId = useMemo(() => activeWorkspace?.projectId ?? "", [activeWorkspace?.projectId]);

  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [dialogTask, setDialogTask] = useState<Partial<KanbanTask> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reduce = useReducedMotion();

  const refresh = useCallback(async () => {
    if (!projectId) return;
    try {
      const list = await kanbanList(projectId);
      setTasks(list);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onDragEnd = useCallback(
    async (result: DropResult) => {
      if (!result.destination) return;
      const fromCol = result.source.droppableId as KanbanTask["status"];
      const toCol = result.destination.droppableId as KanbanTask["status"];
      const moved = tasks.find((t) => t.id === result.draggableId);
      if (!moved) return;

      const newOrder = [...tasks];
      // Strip moved from old column array, insert at new index in target column
      const srcCol = newOrder.filter((t) => t.status === fromCol && t.id !== moved.id);
      const destCol = newOrder.filter((t) => t.status === toCol && t.id !== moved.id);
      destCol.splice(result.destination.index, 0, { ...moved, status: toCol });

      const recompute = (list: KanbanTask[]) =>
        list.map((t, i) => ({ ...t, columnOrder: i }));
      const updatedSrc = recompute(srcCol);
      const updatedDest = recompute(destCol);

      const updated: KanbanTask[] = newOrder.map((t) => {
        if (t.id === moved.id) {
          const idx = updatedDest.findIndex((d) => d.id === moved.id);
          return updatedDest[idx];
        }
        if (t.status === fromCol) {
          const r = updatedSrc.find((s) => s.id === t.id);
          return r ?? t;
        }
        if (t.status === toCol) {
          const r = updatedDest.find((s) => s.id === t.id);
          return r ?? t;
        }
        return t;
      });

      setTasks(updated);

      try {
        // Persist the moved + neighbours' new columnOrder.
        const touched = [...updatedSrc, ...updatedDest];
        await Promise.all(touched.map((t) => kanbanUpsert(t)));
      } catch (e) {
        setError(String(e));
        await refresh();
      }
    },
    [tasks, refresh]
  );

  const upsert = useCallback(
    async (task: Partial<KanbanTask>) => {
      try {
        await kanbanUpsert({ ...task, projectId });
        setDialogTask(null);
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [projectId, refresh]
  );

  if (!projectId) {
    return (
      <div
        data-testid="kanban-empty"
        className="flex h-full w-full items-center justify-center text-xs text-muted-foreground"
      >
        Open a project to use the Kanban board
      </div>
    );
  }

  return (
    <motion.div
      data-testid="kanban-board"
      initial={reduce ? false : { opacity: 0 }}
      animate={reduce ? undefined : { opacity: 1 }}
      transition={{ type: "spring", stiffness: 240, damping: 28 }}
      className="flex h-full w-full flex-col bg-background"
    >
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Kanban
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDialogTask({ status: "backlog", labels: [] })}
          data-testid="kanban-add"
        >
          <Plus className="h-3 w-3" />
          New task
        </Button>
      </div>
      {error && (
        <div className="px-3 py-1.5 text-[11px] text-destructive">{error}</div>
      )}
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto p-2">
          {DEFAULT_COLUMNS.map((col) => (
            <KanbanColumn
              key={col}
              status={col}
              tasks={tasks
                .filter((t) => t.status === col)
                .sort((a, b) => a.columnOrder - b.columnOrder)}
              onEdit={(task) => setDialogTask(task)}
            />
          ))}
        </div>
      </DragDropContext>

      <KanbanTaskDialog
        open={dialogTask !== null}
        task={dialogTask ?? undefined}
        onOpenChange={(o) => !o && setDialogTask(null)}
        onSubmit={upsert}
      />
    </motion.div>
  );
}
