import { useWorkbench } from "@/state/store";

export async function defaultTerminalCwd(): Promise<string> {
  const s = useWorkbench.getState();
  const activeWs = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
  if (activeWs?.worktreePath) return activeWs.worktreePath;
  const firstProject = s.projects[0];
  if (firstProject?.path) return firstProject.path;
  const { desktopDir } = await import("@tauri-apps/api/path");
  return await desktopDir();
}
