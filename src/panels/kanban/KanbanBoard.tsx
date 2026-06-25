import { useCallback, useEffect, useMemo, useState } from "react";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { motion, useReducedMotion } from "framer-motion";
import { useWorkbench } from "@/state/store";
import {
  gitDiffStat,
  kanbanList,
  kanbanUpsert,
  projectSettingsGet,
} from "@/lib/tauri";
import { buildLaunchPrompt } from "@/lib/agent-prompt";
import { resolveStartupLaunch } from "@/lib/launch";
import { resolveTaskBranch } from "@/lib/feature-name";
import { getAgentLaunchMode } from "@/lib/stores/settings";
import { supportsHeadlessLaunch } from "@/lib/agent-launch";
import { useWorkspace } from "@/hooks/useWorkspace";
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

// Stage a task's agent: headless (background run streamed to the Agent Output
// panel — the default) when the mode is headless and the backend supports it,
// else the interactive terminal launch surface. Headless opens the Agent tab.
function stageLaunch(workspaceId: string, backend: string, launchPrompt: string, cwd: string): void {
  const wb = useWorkbench.getState();
  if (getAgentLaunchMode() === "headless" && supportsHeadlessLaunch(backend)) {
    wb.setAgentLaunchSpec(workspaceId, { workspaceId, backend, prompt: launchPrompt, cwd });
    wb.openAgentOutput();
  } else {
    const { command, args } = resolveStartupLaunch(backend);
    wb.setLaunchSpec(workspaceId, { command, args, prompt: launchPrompt });
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
      const launchPrompt = settings ? buildLaunchPrompt(settings.preferences, prompt) : prompt;
      stageLaunch(ws.id, backend, launchPrompt, ws.worktreePath);
      await kanbanUpsert({
        ...task,
        status: "in_progress",
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
      const prompt = settings ? buildLaunchPrompt(settings.preferences, payload.prompt) : payload.prompt;
      stageLaunch(ws.id, payload.agentBackend, prompt, ws.worktreePath);

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
