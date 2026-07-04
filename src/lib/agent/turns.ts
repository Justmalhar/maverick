import type { AgentChatMessage } from "@/lib/ipc";

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
