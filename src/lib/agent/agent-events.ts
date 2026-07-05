import { onAgentEvent, agentState, messagesList } from "@/lib/tauri";
import type { AgentChatMessage, AgentEventPayload, AgentRunStatus, Message } from "@/lib/ipc";
import { useAgentStore } from "@/state/agent-store";
import { useAgentStatusStore, type AgentStatus } from "@/hooks/useAgentStatus";

let subscribed = false;
let rafId: number | null = null;
const pendingDeltas = new Map<string, Array<{ messageId: string; partIndex: number; delta: string }>>();

// The buffer is deliberately global: a non-delta event for ANY session flushes
// ALL sessions' pending deltas — an early flush is a valid flush, and
// per-session delta order is still preserved.
function flushNow(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  for (const [sessionId, deltas] of pendingDeltas) {
    useAgentStore.getState().applyDeltas(sessionId, deltas);
  }
  pendingDeltas.clear();
}

function scheduleFlush(): void {
  if (rafId !== null) return;
  // 16ms coalescing window (same rule as PTY writes): high-frequency token
  // deltas collapse to one store write per frame.
  rafId = requestAnimationFrame(() => {
    rafId = null;
    flushNow();
  });
}

const STATUS_MAP: Record<AgentRunStatus, AgentStatus> = { idle: "idle", working: "working", error: "error" };

function handlePayload(payload: AgentEventPayload): void {
  const { workspaceId, sessionId, event } = payload;
  if (event.type === "part-delta") {
    const list = pendingDeltas.get(sessionId) ?? [];
    list.push({ messageId: event.messageId, partIndex: event.partIndex, delta: event.delta });
    pendingDeltas.set(sessionId, list);
    scheduleFlush();
    return;
  }
  flushNow();
  if (event.type === "status") {
    useAgentStatusStore.getState().setStatus(workspaceId, STATUS_MAP[event.status]);
  }
  useAgentStore.getState().applyEvent(sessionId, event);
}

export function ensureAgentEventSubscription(): void {
  if (subscribed) return;
  subscribed = true;
  onAgentEvent(handlePayload).catch((err) => {
    subscribed = false;
    console.error("[agent-events] failed to subscribe", err);
  });
}

// A tool-call part can only be "running" in a freshly-streamed message: any
// terminal event (tool result, turn-end, or process exit) resolves it. A row
// rehydrated from storage still showing "running" means the process died (or
// the app restarted) mid-tool-call — the result line that would have closed
// it out is never coming, so it must be downgraded instead of spinning forever.
function settleDanglingParts(parts: AgentChatMessage["parts"]): AgentChatMessage["parts"] {
  return parts.map((part) =>
    part.type === "tool-call" && part.status === "running"
      ? { ...part, status: "error", output: part.output ?? "(no result recorded — session interrupted)" }
      : part
  );
}

export function parseStoredMessages(rows: Message[], sessionId: string): AgentChatMessage[] {
  return rows.map((r) => {
    let parts: AgentChatMessage["parts"] | null = null;
    if (r.partsJson) {
      try {
        parts = JSON.parse(r.partsJson);
      } catch {
        parts = null;
      }
    }
    return {
      id: r.id,
      sessionId,
      turnId: r.turnId ?? r.id,
      role: r.role === "tool" ? "system" : r.role,
      parts: settleDanglingParts(parts ?? [{ type: "text", text: r.content }]),
      createdAt: r.createdAt,
    };
  });
}

export async function hydrateAgentSession(workspaceId: string, sessionId: string): Promise<void> {
  ensureAgentEventSubscription();
  const [snap, rows] = await Promise.all([agentState(workspaceId), messagesList(sessionId, 1000, 0)]);
  useAgentStore.getState().hydrate(sessionId, parseStoredMessages(rows, sessionId), snap);
}

export const __testing__ = { handlePayload, flushNow, reset: () => { pendingDeltas.clear(); if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; } } };
