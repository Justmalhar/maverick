import { useEffect } from "react";
import { useWorkbench } from "@/state/store";
import { automationActivateTriggers, automationDeactivateTriggers } from "@/lib/tauri";
import type { Workspace } from "@/lib/ipc";

// Activates a workspace's schedule/on-file-change automation triggers for the
// lifetime it's open (mounted), and deactivates on close/unmount. Triggers are
// scoped per-open-workspace by design (see the automation-triggers spec): no
// firing while the workspace/app is closed, no orphan timers/watchers. Best-
// effort — a backend hiccup must never break the editor.
export function useAutomationTriggers(workspace: Workspace): void {
  const projectPath = useWorkbench(
    (s) => s.projects.find((p) => p.id === workspace.projectId)?.path,
  );

  useEffect(() => {
    if (!projectPath || !workspace.worktreePath) return;
    void automationActivateTriggers(workspace.id, projectPath, workspace.worktreePath).catch(
      (e) => console.warn("activateTriggers failed", e),
    );
    return () => {
      void automationDeactivateTriggers(workspace.id).catch(() => {});
    };
  }, [workspace.id, workspace.worktreePath, projectPath]);
}
