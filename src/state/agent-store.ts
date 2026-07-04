import { create } from "zustand";
import type {
  AgentChatMessage, AgentEvent, AgentPart, AgentRunStatus, AgentSessionSnapshot, QueuedMessage,
} from "@/lib/ipc";

export interface AgentSessionSlice {
  messages: AgentChatMessage[];
  status: AgentRunStatus;
  queue: QueuedMessage[];
  model: string | null;
  reasoningLevel: string | null;
  hydrated: boolean;
}

export function emptySession(): AgentSessionSlice {
  return { messages: [], status: "idle", queue: [], model: null, reasoningLevel: null, hydrated: false };
}

interface AgentStoreState {
  sessions: Record<string, AgentSessionSlice>;
  applyEvent: (sessionId: string, event: AgentEvent) => void;
  applyDeltas: (sessionId: string, deltas: Array<{ messageId: string; partIndex: number; delta: string }>) => void;
  hydrate: (sessionId: string, messages: AgentChatMessage[], snap: AgentSessionSnapshot) => void;
  setOptionsLocal: (sessionId: string, opts: { model?: string; reasoningLevel?: string }) => void;
  reset: (sessionId: string) => void;
}

function appendDelta(part: AgentPart, delta: string): AgentPart {
  if (part.type === "text") return { ...part, text: part.text + delta };
  if (part.type === "thinking") return { ...part, summary: part.summary + delta };
  return part;
}

function mergeToolPart(existing: AgentPart, incoming: AgentPart): AgentPart {
  if (existing.type !== "tool-call" || incoming.type !== "tool-call") return incoming;
  return {
    ...existing,
    status: incoming.status,
    ...(incoming.output !== undefined ? { output: incoming.output } : {}),
    ...(incoming.durationMs !== undefined ? { durationMs: incoming.durationMs } : {}),
    ...(incoming.fileChanges !== undefined ? { fileChanges: incoming.fileChanges } : {}),
  };
}

function withPart(
  messages: AgentChatMessage[],
  messageId: string,
  partIndex: number,
  update: (part: AgentPart | undefined) => AgentPart
): AgentChatMessage[] {
  return messages.map((m) => {
    if (m.id !== messageId) return m;
    const parts = [...m.parts];
    while (parts.length < partIndex) parts.push({ type: "text", text: "" });
    parts[partIndex] = update(parts[partIndex]);
    return { ...m, parts };
  });
}

let errorSeq = 0;

function reduceEvent(slice: AgentSessionSlice, sessionId: string, event: AgentEvent): AgentSessionSlice {
  switch (event.type) {
    case "message-start": {
      if (slice.messages.some((m) => m.id === event.message.id)) return slice;
      return { ...slice, messages: [...slice.messages, event.message] };
    }
    case "message-end": {
      const exists = slice.messages.some((m) => m.id === event.message.id);
      return {
        ...slice,
        messages: exists
          ? slice.messages.map((m) => (m.id === event.message.id ? event.message : m))
          : [...slice.messages, event.message],
      };
    }
    case "part-start":
      return { ...slice, messages: withPart(slice.messages, event.messageId, event.partIndex, () => event.part) };
    case "part-end":
      return {
        ...slice,
        messages: withPart(slice.messages, event.messageId, event.partIndex, (p) =>
          p && p.type === "tool-call" && event.part.type === "tool-call" ? mergeToolPart(p, event.part) : event.part
        ),
      };
    case "status":
      return { ...slice, status: event.status };
    case "queue-updated":
      return { ...slice, queue: event.queue };
    case "error": {
      errorSeq += 1;
      const errMsg: AgentChatMessage = {
        id: `err_${sessionId}_${slice.messages.length}_${errorSeq}`,
        sessionId,
        turnId: "error",
        role: "system",
        parts: [{ type: "text", text: event.message }],
        createdAt: 0,
      };
      return { ...slice, messages: [...slice.messages, errMsg] };
    }
    case "session-meta":
    case "part-delta":
    case "turn-end":
    case "permission-request":
      return slice;
  }
}

export const useAgentStore = create<AgentStoreState>((set) => ({
  sessions: {},

  applyEvent: (sessionId, event) =>
    set((s) => {
      const slice = s.sessions[sessionId] ?? emptySession();
      const next = reduceEvent(slice, sessionId, event);
      if (next === slice) return s;
      return { sessions: { ...s.sessions, [sessionId]: next } };
    }),

  applyDeltas: (sessionId, deltas) =>
    set((s) => {
      const slice = s.sessions[sessionId] ?? emptySession();
      let messages = slice.messages;
      for (const d of deltas) {
        messages = withPart(messages, d.messageId, d.partIndex, (p) =>
          p ? appendDelta(p, d.delta) : { type: "text", text: d.delta }
        );
      }
      return { sessions: { ...s.sessions, [sessionId]: { ...slice, messages } } };
    }),

  hydrate: (sessionId, messages, snap) =>
    set((s) => {
      const slice = s.sessions[sessionId] ?? emptySession();
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...slice,
            messages,
            status: snap.status,
            queue: snap.queue,
            model: snap.model,
            reasoningLevel: snap.reasoningLevel,
            hydrated: true,
          },
        },
      };
    }),

  setOptionsLocal: (sessionId, opts) =>
    set((s) => {
      const slice = s.sessions[sessionId] ?? emptySession();
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...slice,
            ...(opts.model !== undefined ? { model: opts.model } : {}),
            ...(opts.reasoningLevel !== undefined ? { reasoningLevel: opts.reasoningLevel } : {}),
          },
        },
      };
    }),

  reset: (sessionId) =>
    set((s) => {
      const sessions = { ...s.sessions };
      delete sessions[sessionId];
      return { sessions };
    }),
}));
