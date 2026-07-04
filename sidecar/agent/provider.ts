import { claudeAdapter } from "./providers/claude";
import type { AgentCapabilities, AgentEvent, AgentPart } from "../types";

export interface SpawnOpts {
  worktreePath: string;
  model: string | null;
  reasoningLevel: string | null;
  resumeSessionId: string | null;
}

export interface TurnIds {
  uuid(prefix: string): string;
  now(): number;
}

/** Per-turn mutable translation state, owned by the session manager. */
export interface TurnContext {
  sessionId: string;
  turnId: string;
  ids: TurnIds;
  current: { messageId: string; parts: AgentPart[] } | null;
  /** toolUseId → location of its running tool-call part. */
  tools: Map<string, { messageId: string; partIndex: number; startedAt: number }>;
  /** Lines the adapter could not map — surfaced in the turn footer. */
  unknownLines: number;
}

export interface AgentProviderAdapter {
  id: string;
  capabilities(worktreePath: string): AgentCapabilities;
  buildSpawn(opts: SpawnOpts): string[];
  encodeUserMessage(parts: AgentPart[]): string;
  /** Returns the control line, or null if the provider needs a signal instead. */
  encodeInterrupt(requestId: string): string | null;
  translate(line: string, ctx: TurnContext): AgentEvent[];
}

export function adapterFor(backend: string | undefined): AgentProviderAdapter {
  // Codex/Gemini adapters land later; claude is the correct fallback for every
  // currently-shipping backend id (mirrors oneShotSpecFor).
  return claudeAdapter;
}
