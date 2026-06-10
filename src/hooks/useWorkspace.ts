import { useCallback } from "react";
import { useWorkbench } from "@/state/store";
import {
  workspaceCreate,
  workspaceDestroy,
  workspaceList,
  projectAdd,
  projectList,
  detectBackends,
  bootstrapStatus,
} from "@/lib/tauri";
import { brandFor } from "@/lib/backend-brand";
import { killAgentPty } from "@/components/editor/agent/AgentTerminal";
import { killWorkspaceLeaves } from "@/components/editor/terminal/TerminalLeaf";
import type { Backend } from "@/lib/ipc";

export function useWorkspace() {
  const addWorkspace = useWorkbench((s) => s.addWorkspace);
  const removeWorkspace = useWorkbench((s) => s.removeWorkspace);
  const setWorkspaces = useWorkbench((s) => s.setWorkspaces);
  const addProject = useWorkbench((s) => s.addProject);
  const setProjects = useWorkbench((s) => s.setProjects);
  const setActiveWorkspace = useWorkbench((s) => s.setActiveWorkspace);
  const setBackends = useWorkbench((s) => s.setBackends);

  const create = useCallback(
    // branch === undefined lets the sidecar generate a unique callsign branch.
    async (projectId: string, branch: string | undefined, backend: string, baseBranch?: string) => {
      const project = useWorkbench.getState().projects.find((p) => p.id === projectId);
      if (!project) {
        throw new Error(`Cannot create workspace: project ${projectId} not found`);
      }
      const ws = await workspaceCreate(projectId, project.path, branch, backend, baseBranch);
      addWorkspace(ws);
      setActiveWorkspace(ws.id);
      // The setup script streams through the Panel's Setup tab — never the
      // editor area — so the agent terminal is usable while it runs.
      useWorkbench.getState().queueSetup(ws.id);
      window.dispatchEvent(new CustomEvent("maverick:panel:tab", { detail: "setup" }));
      return ws;
    },
    [addWorkspace, setActiveWorkspace]
  );

  const destroy = useCallback(
    async (workspaceId: string) => {
      // Kill the workspace's PTYs first — their cwd is the worktree that
      // workspaceDestroy is about to remove. ptyKill had zero callers before,
      // so every destroyed workspace leaked an OS process + reader thread.
      killAgentPty(workspaceId);
      killWorkspaceLeaves(workspaceId);
      await workspaceDestroy(workspaceId);
      removeWorkspace(workspaceId);
    },
    [removeWorkspace]
  );

  const refreshWorkspaces = useCallback(
    async (projectId?: string) => {
      const list = await workspaceList(projectId);
      setWorkspaces(list);
      return list;
    },
    [setWorkspaces]
  );

  const addProjectFromPath = useCallback(
    async (path: string) => {
      const p = await projectAdd(path);
      addProject(p);
      return p;
    },
    [addProject]
  );

  const refreshProjects = useCallback(async () => {
    const list = await projectList();
    setProjects(list);
    return list;
  }, [setProjects]);

  const refreshBackends = useCallback(async () => {
    const [detected, status] = await Promise.all([detectBackends(), bootstrapStatus()]);
    const defaultName = status?.settings?.defaultBackend ?? null;
    const backends: Backend[] = detected
      .filter((d) => d.installed)
      .map((d) => ({
        id: d.name,
        name: brandFor(d.name)?.label ?? d.name,
        command: d.path ?? d.command,
        args: [],
        env: {},
        active: d.name === defaultName,
      }));
    setBackends(backends);
    return backends;
  }, [setBackends]);

  return {
    create,
    destroy,
    refreshWorkspaces,
    addProjectFromPath,
    refreshProjects,
    refreshBackends,
  };
}
