import { create } from "zustand";

export interface AgentLine {
  id: number;
  kind: "text" | "tool" | "result" | "stderr";
  text: string;
  isError?: boolean;
}

export interface AgentRun {
  lines: AgentLine[];
  // Captured from the stream-json init/result events; used to `--resume` follow-ups.
  sessionId?: string;
  running: boolean;
  costUsd?: number;
}

// Bound the per-workspace buffer so a chatty agent can't grow memory unbounded
// (CLAUDE.md RSS budget). Oldest lines drop first.
const MAX_LINES = 5000;

const EMPTY: AgentRun = { lines: [], running: false };

interface AgentOutputState {
  runs: Record<string, AgentRun>;
  /** Begin (or resume) a run for a workspace — marks it running, keeps prior history. */
  start: (workspaceId: string) => void;
  appendLine: (workspaceId: string, line: Omit<AgentLine, "id">) => void;
  setSession: (workspaceId: string, sessionId: string) => void;
  finish: (workspaceId: string, opts?: { costUsd?: number }) => void;
  clearForWorkspace: (workspaceId: string) => void;
}

let seq = 0;

function runFor(runs: Record<string, AgentRun>, workspaceId: string): AgentRun {
  return runs[workspaceId] ?? EMPTY;
}

export const useAgentOutput = create<AgentOutputState>((set) => ({
  runs: {},
  start: (workspaceId) =>
    set((s) => ({
      runs: { ...s.runs, [workspaceId]: { ...runFor(s.runs, workspaceId), running: true } },
    })),
  appendLine: (workspaceId, line) =>
    set((s) => {
      const prev = runFor(s.runs, workspaceId);
      const lines = [...prev.lines, { ...line, id: ++seq }];
      if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
      return { runs: { ...s.runs, [workspaceId]: { ...prev, lines } } };
    }),
  setSession: (workspaceId, sessionId) =>
    set((s) => ({
      runs: { ...s.runs, [workspaceId]: { ...runFor(s.runs, workspaceId), sessionId } },
    })),
  finish: (workspaceId, opts) =>
    set((s) => {
      const prev = runFor(s.runs, workspaceId);
      return {
        runs: {
          ...s.runs,
          // Preserve a cost already captured from the `result` event: `agent.exit`
          // always fires afterwards and calls finish() with no opts, which would
          // otherwise wipe it (`?? prev` keeps 0 — a valid cost — untouched).
          [workspaceId]: { ...prev, running: false, costUsd: opts?.costUsd ?? prev.costUsd },
        },
      };
    }),
  clearForWorkspace: (workspaceId) =>
    set((s) => {
      const next = { ...s.runs };
      delete next[workspaceId];
      return { runs: next };
    }),
}));

/** Selector: the run state for a workspace (never undefined). */
export const selectAgentRun =
  (workspaceId: string) =>
  (s: AgentOutputState): AgentRun =>
    s.runs[workspaceId] ?? EMPTY;
