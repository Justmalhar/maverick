import { useEffect } from "react";
import { notifySend } from "@/lib/tauri";
import { useWorkbench } from "@/state/store";
import { useAgentStatusStore, type AgentStatus } from "./useAgentStatus";

interface NotifyMeta {
  title: string;
  verb: string;
  type: string;
}

// Only terminal / input-needed transitions are worth interrupting the user for.
// `working` and `idle` are routine and never notify.
const NOTIFY_META: Partial<Record<AgentStatus, NotifyMeta>> = {
  done: { title: "Agent finished", verb: "finished its task", type: "agent.done" },
  error: { title: "Agent error", verb: "exited with an error", type: "agent.error" },
  attention: { title: "Agent needs input", verb: "is waiting for your input", type: "agent.attention" },
};

/**
 * Bridges agent-status transitions to the notification surface. Mount once
 * (app shell). On a transition *into* done/error/attention it raises a
 * `notify_send`; the backend records history and emits `notification:send`,
 * which the Toaster routes (OS toast / in-app / suppressed) by focus. The store
 * subscription only fires on changes, so statuses present at mount never notify,
 * and `setStatus` de-dupes identical writes so a status never double-fires.
 */
export function useAgentNotifications(): void {
  useEffect(() => {
    return useAgentStatusStore.subscribe((state, prev) => {
      for (const [workspaceId, status] of Object.entries(state.statuses)) {
        if (prev.statuses[workspaceId] === status) continue;
        const meta = NOTIFY_META[status];
        if (!meta) continue;
        const ws = useWorkbench.getState().workspaces.find((w) => w.id === workspaceId);
        const label = ws?.title || ws?.branch || "Agent";
        void notifySend(meta.title, `${label} ${meta.verb}`, workspaceId, meta.type).catch(() => {});
      }
    });
  }, []);
}
