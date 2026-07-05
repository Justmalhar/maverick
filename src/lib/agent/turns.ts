import type { AgentChatMessage, AgentFileChange } from "@/lib/ipc";

export interface Turn {
  turnId: string;
  user: AgentChatMessage | null;
  assistant: AgentChatMessage[];
  system: AgentChatMessage[];
}

export function groupIntoTurns(messages: AgentChatMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      turns.push({ turnId: msg.turnId, user: msg, assistant: [], system: [] });
      continue;
    }
    let turn = turns.at(-1);
    if (!turn || (msg.role === "assistant" && turn.turnId !== msg.turnId && msg.turnId !== "error")) {
      turn = { turnId: msg.turnId, user: null, assistant: [], system: [] };
      turns.push(turn);
    }
    (msg.role === "assistant" ? turn.assistant : turn.system).push(msg);
  }
  return turns;
}

/** Unique-by-path file changes across a turn's tool-call parts, additions/deletions summed. */
export function aggregateTurnFileChanges(messages: AgentChatMessage[]): AgentFileChange[] {
  const byPath = new Map<string, AgentFileChange>();
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type !== "tool-call" || !part.fileChanges) continue;
      for (const change of part.fileChanges) {
        const existing = byPath.get(change.path);
        byPath.set(
          change.path,
          existing
            ? { ...existing, additions: existing.additions + change.additions, deletions: existing.deletions + change.deletions, kind: change.kind }
            : { ...change }
        );
      }
    }
  }
  return [...byPath.values()];
}
