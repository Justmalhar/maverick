import { useEffect } from "react";
import { useWorkbench } from "@/state/store";
import { onAutopilotTriggered, workspaceCreate } from "@/lib/tauri";
import { resolveStartupLaunch } from "@/lib/launch";

/**
 * Starts the workspace for a sidecar-triggered Autopilot run. Unlike a manual
 * Kanban "Start" this must not steal focus from whatever the user is doing —
 * it skips setActiveWorkspace, relying only on queueSetup to surface the
 * Panel so the run is never silently invisible.
 */
export function useAutopilotBridge(): void {
  useEffect(() => {
    const offPromise = onAutopilotTriggered(async (t) => {
      const state = useWorkbench.getState();
      const project = state.projects.find((p) => p.id === t.projectId);
      if (!project) {
        console.error(`Autopilot "${t.name}": project ${t.projectId} not found`);
        return;
      }
      const backend =
        t.backend || state.backends.find((b) => b.active)?.id || state.backends[0]?.id || "claude";
      try {
        const ws = await workspaceCreate(t.projectId, project.path, t.branch || undefined, backend);
        useWorkbench.getState().addWorkspace(ws);
        const { command, args } = resolveStartupLaunch(backend);
        useWorkbench.getState().setLaunchSpec(ws.id, { command, args, prompt: t.prompt });
        useWorkbench.getState().queueSetup(ws.id);
      } catch (e) {
        console.error(`Autopilot "${t.name}" failed to start a workspace`, e);
      }
    });
    return () => {
      void offPromise.then((fn) => fn());
    };
  }, []);
}
