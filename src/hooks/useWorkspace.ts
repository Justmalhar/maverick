import { useCallback } from "react";
import { useWorkbench } from "@/state/store";
import {
  workspaceCreate,
  workspaceDestroy,
  workspaceList,
  projectAdd,
  projectList,
} from "@/lib/tauri";

export function useWorkspace() {
  const addWorkspace = useWorkbench((s) => s.addWorkspace);
  const removeWorkspace = useWorkbench((s) => s.removeWorkspace);
  const setWorkspaces = useWorkbench((s) => s.setWorkspaces);
  const addProject = useWorkbench((s) => s.addProject);
  const setProjects = useWorkbench((s) => s.setProjects);
  const setActiveWorkspace = useWorkbench((s) => s.setActiveWorkspace);

  const create = useCallback(
    async (projectId: string, branch: string, backend: string) => {
      const ws = await workspaceCreate(projectId, branch, backend);
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

  return {
    create,
    destroy,
    refreshWorkspaces,
    addProjectFromPath,
    refreshProjects,
  };
}
