import { create } from "zustand";
import { useEffect, useRef } from "react";

export type AgentStatus = "idle" | "working" | "attention" | "done" | "error";

/** Quiet window after the last output chunk before a working agent goes idle. */
export const IDLE_AFTER_MS = 1200;

/** BEL or the iTerm2/macOS attention OSC (ESC ] 9 ; …) signals user attention. */
const ATTENTION_PATTERN = /\x07|\x1b\]9;/;

export function streamRequestsAttention(data: string): boolean {
  return ATTENTION_PATTERN.test(data);
}

/** Map a pty:exit code to a terminal status. Zero is a clean finish. */
export function statusForExit(code: number): AgentStatus {
  return code === 0 ? "done" : "error";
}

interface AgentStatusState {
  statuses: Record<string, AgentStatus>;
  /** Set/override a workspace's status. */
  setStatus: (workspaceId: string, status: AgentStatus) => void;
  /** Drop a workspace's tracked status (on destroy). */
  clearStatus: (workspaceId: string) => void;
}

export const useAgentStatusStore = create<AgentStatusState>((set) => ({
  statuses: {},
  setStatus: (workspaceId, status) =>
    set((s) =>
      s.statuses[workspaceId] === status
        ? s
        : { statuses: { ...s.statuses, [workspaceId]: status } }
    ),
  clearStatus: (workspaceId) =>
    set((s) => {
      if (!(workspaceId in s.statuses)) return s;
      const next = { ...s.statuses };
      delete next[workspaceId];
      return { statuses: next };
    }),
}));

/** Read a single workspace's status (defaults to idle when untracked). */
export function useAgentStatus(workspaceId: string): AgentStatus {
  return useAgentStatusStore((s) => s.statuses[workspaceId] ?? "idle");
}

/**
 * Returns a debounced reporter bound to a workspace, driving the shared store
 * from the AgentTerminal PTY output stream. Output flips the status to
 * `working` (or `attention` on a BEL/OSC) and arms a quiet-period timer that
 * relaxes back to `idle`; `markExit` records `done`/`error` and cancels the
 * timer. The timer is the debounce — per-chunk store writes are coalesced to a
 * single `working` set + one deferred `idle` set, so the pill never flickers.
 */
export function useAgentStatusReporter(workspaceId: string): {
  reportOutput: (data: string) => void;
  markExit: (code: number) => void;
} {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A finished agent (done/error) must not be revived to idle by a late timer.
  const exitedRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const reportOutputRef = useRef<(data: string) => void>(() => {});
  const markExitRef = useRef<(code: number) => void>(() => {});

  reportOutputRef.current = (data: string) => {
    if (exitedRef.current) return;
    const { setStatus } = useAgentStatusStore.getState();
    setStatus(workspaceId, streamRequestsAttention(data) ? "attention" : "working");
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (!exitedRef.current) useAgentStatusStore.getState().setStatus(workspaceId, "idle");
    }, IDLE_AFTER_MS);
  };

  markExitRef.current = (code: number) => {
    exitedRef.current = true;
    clearTimer();
    useAgentStatusStore.getState().setStatus(workspaceId, statusForExit(code));
  };

  useEffect(() => {
    exitedRef.current = false;
    return () => clearTimer();
  }, [workspaceId]);

  return {
    reportOutput: (data: string) => reportOutputRef.current(data),
    markExit: (code: number) => markExitRef.current(code),
  };
}
