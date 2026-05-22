import { useCallback, useEffect, useMemo, useState } from "react";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { motion, useReducedMotion } from "framer-motion";
import { useWorkbench } from "@/state/store";
import {
  gitDiffStat,
  kanbanList,
  kanbanUpsert,
  workspaceCreate,
} from "@/lib/tauri";
import type { DiffStat, KanbanTask } from "@/lib/ipc";
import KanbanColumn from "./KanbanColumn";
import KanbanTaskDialog from "./KanbanTaskDialog";
import TaskComposer, { type ComposerPayload } from "./TaskComposer";
import ProjectFilterTabs from "./ProjectFilterTabs";

const DEFAULT_COLUMNS: KanbanTask["status"][] = [
  "todo",
  "in_progress",
  "review",
  "done",
];

export default function KanbanBoard() {
  const workspaces = useWorkbench((s) => s.workspaces);
  const addWorkspace = useWorkbench((s) => s.addWorkspace);
  const setActiveWorkspace = useWorkbench((s) => s.setActiveWorkspace);

  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [dialogTask, setDialogTask] = useState<Partial<KanbanTask> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterProjectId, setFilterProjectId] = useState<string | null>(null);
  const [diffStatCache, setDiffStatCache] = useState<Map<string, DiffStat>>(new Map());
  const reduce = useReducedMotion();

  const refresh = useCallback(async () => {
    try {
      const list = await kanbanList("");
      setTasks(list);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    tasks
      .filter((t) => t.workspaceId && !diffStatCache.has(t.workspaceId))
      .forEach((task) => {
        const ws = workspaces.find((w) => w.id === task.workspaceId);
        if (!ws) return;
        gitDiffStat(ws.worktreePath)
          .then((stat) => {
            setDiffStatCache((prev) => new Map(prev).set(task.workspaceId!, stat));
          })
          .catch(() => {
            /* silently ignore */
          });
      });
  }, [tasks, workspaces, diffStatCache]);

  const filteredTasks = useMemo(
    () =>
      filterProjectId
        ? tasks.filter((t) => t.projectId === filterProjectId)
        : tasks,
    [tasks, filterProjectId]
  );

  const onDragEnd = useCallback(
    async (result: DropResult) => {
      if (!result.destination) return;
      const fromCol = result.source.droppableId as KanbanTask["status"];
      const toCol = result.destination.droppableId as KanbanTask["status"];
      const moved = tasks.find((t) => t.id === result.draggableId);
      if (!moved) return;

      const newOrder = [...tasks];
      const srcCol = newOrder.filter((t) => t.status === fromCol && t.id !== moved.id);
      const destCol = newOrder.filter((t) => t.status === toCol && t.id !== moved.id);
      destCol.splice(result.destination.index, 0, { ...moved, status: toCol });

      const recompute = (list: KanbanTask[]) =>
        list.map((t, i) => ({ ...t, columnOrder: i }));
      const updatedSrc = recompute(srcCol);
      const updatedDest = recompute(destCol);

      const updated = newOrder.map((t) => {
        if (t.id === moved.id) return updatedDest.find((d) => d.id === moved.id)!;
        if (t.status === fromCol) return updatedSrc.find((s) => s.id === t.id) ?? t;
        if (t.status === toCol) return updatedDest.find((s) => s.id === t.id) ?? t;
        return t;
      });

      setTasks(updated);
      try {
        await Promise.all([...updatedSrc, ...updatedDest].map((t) => kanbanUpsert(t)));
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
        await kanbanUpsert(task);
        setDialogTask(null);
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh]
  );

  const onSend = useCallback(
    async (payload: ComposerPayload) => {
      const maxOrder = tasks
        .filter((t) => t.status === "todo")
        .reduce((max, t) => Math.max(max, t.columnOrder), -1);

      const task = await kanbanUpsert({
        status: "todo",
        title: payload.prompt.split("\n")[0].slice(0, 80),
        description: payload.prompt,
        agentBackend: payload.agentBackend,
        branch: payload.branch,
        attachments: payload.attachments,
        projectId: payload.projectId,
        columnOrder: maxOrder + 1,
        labels: [],
        createdAt: Math.floor(Date.now() / 1000),
      });

      const ws = await workspaceCreate(
        payload.projectId,
        payload.branch,
        payload.agentBackend
      );

      await kanbanUpsert({
        id: task.id,
        projectId: task.projectId,
        title: task.title,
        labels: task.labels,
        columnOrder: task.columnOrder,
        attachments: task.attachments,
        agentBackend: task.agentBackend,
        branch: task.branch,
        status: "in_progress",
        workspaceId: ws.id,
      });

      addWorkspace(ws);
      setActiveWorkspace(ws.id);
      await refresh();
    },
    [tasks, addWorkspace, setActiveWorkspace, refresh]
  );

  return (
    <motion.div
      data-testid="kanban-board"
      initial={reduce ? false : { opacity: 0 }}
      animate={reduce ? undefined : { opacity: 1 }}
      transition={{ type: "spring", stiffness: 240, damping: 28 }}
      className="flex h-full w-full flex-col bg-background"
    >
      <TaskComposer onSend={onSend} />
      <ProjectFilterTabs
        filterProjectId={filterProjectId}
        onFilterChange={setFilterProjectId}
      />
      {error && (
        <div className="px-3 py-1.5 text-[11px] text-destructive">{error}</div>
      )}
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto p-2">
          {DEFAULT_COLUMNS.map((col) => (
            <KanbanColumn
              key={col}
              status={col}
              tasks={filteredTasks
                .filter((t) => t.status === col)
                .sort((a, b) => a.columnOrder - b.columnOrder)}
              diffStatCache={diffStatCache}
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
