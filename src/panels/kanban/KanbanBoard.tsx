import { useCallback, useEffect, useMemo, useState } from "react";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { motion, useReducedMotion } from "framer-motion";
import { useWorkbench } from "@/state/store";
import {
  gitDiffStat,
  kanbanDelete,
  kanbanList,
  kanbanMaterializeAttachments,
  kanbanUpsert,
  projectSettingsGet,
} from "@/lib/tauri";
import { appendAttachments, buildLaunchPrompt } from "@/lib/agent-prompt";
import { resolveStartupLaunch } from "@/lib/launch";
import { resolveTaskBranch } from "@/lib/feature-name";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { Attachment, DiffStat, KanbanTask } from "@/lib/ipc";
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

// Stage a task's agent for launch in the workspace's interactive terminal: the
// primary terminal leaf consumes the spec once its shell PTY is ready.
function stageLaunch(workspaceId: string, backend: string, launchPrompt: string): void {
  const { command, args } = resolveStartupLaunch(backend);
  useWorkbench.getState().setLaunchSpec(workspaceId, { command, args, prompt: launchPrompt });
}

// Best-effort: a materialization failure (e.g. disk full) must not block the
// launch — the task still starts, just without attachment paths in the prompt.
async function materializeAndAppend(
  worktreePath: string,
  taskId: string,
  attachments: Attachment[],
  prompt: string
): Promise<string> {
  if (attachments.length === 0) return prompt;
  try {
    const { paths } = await kanbanMaterializeAttachments(worktreePath, taskId, attachments);
    return appendAttachments(prompt, paths);
  } catch (e) {
    console.warn("materializeAttachments failed; launching without attachments", e);
    return prompt;
  }
}


export default function KanbanBoard() {
  const workspaces = useWorkbench((s) => s.workspaces);
  const { create } = useWorkspace();

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

      // No-op drop (dropped back where it started) — nothing to persist.
      if (fromCol === toCol && result.source.index === result.destination.index) return;

      const recompute = (list: KanbanTask[]) =>
        list.map((t, i) => ({ ...t, columnOrder: i }));

      // `changed` holds every card whose order/status moved, each exactly once.
      let changed: KanbanTask[];
      if (fromCol === toCol) {
        // Reorder within one column: pull the card out, reinsert at the target
        // index, then reindex the whole column once. Reindexing both a "src" and
        // a "dest" view of the same column (the old code) gave the moved card and
        // its neighbours colliding column_order values.
        const col = tasks.filter((t) => t.status === fromCol && t.id !== moved.id);
        col.splice(result.destination.index, 0, { ...moved, status: toCol });
        changed = recompute(col);
      } else {
        const updatedSrc = recompute(tasks.filter((t) => t.status === fromCol && t.id !== moved.id));
        const destCol = tasks.filter((t) => t.status === toCol && t.id !== moved.id);
        destCol.splice(result.destination.index, 0, { ...moved, status: toCol });
        changed = [...updatedSrc, ...recompute(destCol)];
      }

      const changedById = new Map(changed.map((t) => [t.id, t]));
      setTasks(tasks.map((t) => changedById.get(t.id) ?? t));
      try {
        // Dedup by id so each task is written exactly once (no ordering race).
        await Promise.all(changed.map((t) => kanbanUpsert(t)));
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

  const remove = useCallback(
    async (id: string) => {
      try {
        await kanbanDelete(id);
        setDialogTask(null);
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh]
  );

  const handleStart = useCallback(
    async (task: KanbanTask) => {
      const baseBranch = task.branch || "main";
      const backend =
        task.agentBackend ||
        useWorkbench.getState().backends.find((b) => b.active)?.id ||
        useWorkbench.getState().backends[0]?.id ||
        "claude-code";
      const prompt = task.description
        ? `${task.title}\n\n${task.description}`
        : task.title;
      const projectPath = useWorkbench.getState().projects.find((p) => p.id === task.projectId)?.path;
      // Fetch settings once: the branchRename preference drives the branch name
      // and the rest of the preferences are prepended to the launch prompt.
      // Best-effort — a settings failure must not block starting the task.
      let settings: Awaited<ReturnType<typeof projectSettingsGet>> | null = null;
      try {
        settings = await projectSettingsGet(task.projectId);
      } catch (e) {
        console.warn("projectSettingsGet failed; naming and launching without preferences", e);
      }
      const branch = await resolveTaskBranch({
        title: task.title,
        prompt,
        cwd: projectPath,
        backend,
        instructions: settings?.preferences?.branchRename,
      });
      const ws = await create(task.projectId, branch, backend, baseBranch);
      const launchPrompt = await materializeAndAppend(
        ws.worktreePath,
        task.id,
        task.attachments,
        settings ? buildLaunchPrompt(settings.preferences, prompt) : prompt
      );
      stageLaunch(ws.id, backend, launchPrompt);
      // Link the task to the workspace it just spawned — without this the card's
      // View button (and the diff-stat lookup) can't find the workspace.
      await kanbanUpsert({
        ...task,
        status: "in_progress",
        workspaceId: ws.id,
      });
      await refresh();
    },
    [create, refresh]
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
        branch: payload.baseBranch,
        attachments: payload.attachments,
        projectId: payload.projectId,
        columnOrder: maxOrder + 1,
        labels: [],
        createdAt: Math.floor(Date.now() / 1000),
      });

      // Fetch settings once: the branchRename preference drives the branch name
      // (AI-generated from the task, honoring the project's convention — never a
      // random callsign), and the full preference set is prepended to the launch
      // prompt. Best-effort: a settings failure must not block starting the task.
      const projectPath = useWorkbench
        .getState()
        .projects.find((p) => p.id === payload.projectId)?.path;
      let settings: Awaited<ReturnType<typeof projectSettingsGet>> | null = null;
      try {
        settings = await projectSettingsGet(payload.projectId);
      } catch (e) {
        console.warn("projectSettingsGet failed; naming and launching without preferences", e);
      }
      const branch = await resolveTaskBranch({
        title: payload.prompt.split("\n")[0],
        prompt: payload.prompt,
        cwd: projectPath,
        backend: payload.agentBackend,
        instructions: settings?.preferences?.branchRename,
      });
      const ws = await create(payload.projectId, branch, payload.agentBackend, payload.baseBranch);
      const prompt = await materializeAndAppend(
        ws.worktreePath,
        task.id,
        payload.attachments,
        settings ? buildLaunchPrompt(settings.preferences, payload.prompt) : payload.prompt
      );
      stageLaunch(ws.id, payload.agentBackend, prompt);

      // Spread the persisted task so the description (and every other field) is
      // carried through — listing the fields by hand dropped `description`,
      // which the full-row upsert then nulled out.
      await kanbanUpsert({
        ...task,
        status: "in_progress",
        workspaceId: ws.id,
      });

      await refresh();
    },
    [tasks, create, refresh]
  );

  return (
    <motion.div
      data-testid="kanban-board"
      initial={reduce ? false : { opacity: 0 }}
      animate={reduce ? undefined : { opacity: 1 }}
      transition={{ type: "spring", stiffness: 240, damping: 28 }}
      className="flex h-full w-full flex-col bg-background"
    >
      <TaskComposer onSend={onSend} defaultProjectId={filterProjectId} />
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
              onStart={handleStart}
              onDelete={remove}
            />
          ))}
        </div>
      </DragDropContext>

      <KanbanTaskDialog
        open={dialogTask !== null}
        task={dialogTask ?? undefined}
        onOpenChange={(o) => !o && setDialogTask(null)}
        onSubmit={upsert}
        onDelete={remove}
      />
    </motion.div>
  );
}
