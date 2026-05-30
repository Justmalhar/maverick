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
    async (projectId: string, branch: string, backend: string, baseBranch?: string) => {
      const project = useWorkbench.getState().projects.find((p) => p.id === projectId);
      if (!project) {
        throw new Error(`Cannot create workspace: project ${projectId} not found`);
      }
      const ws = await workspaceCreate(projectId, project.path, branch, backend, baseBranch);
      addWorkspace(ws);
      setActiveWorkspace(ws.id);
      return ws;
    },
    [addWorkspace, setActiveWorkspace]
  );

  const destroy = useCallback(
    async (workspaceId: string) => {
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
