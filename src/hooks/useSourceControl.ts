// Ported from terax useSourceControl.ts: inflight-coalescing + throttled
// auto-fetch + requestId stale-guard. Drives the StatusBar ahead/behind
// indicator off the current branch reported by git_branch_list.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gitBranchList, gitFetch, gitPull, gitPush } from "@/lib/tauri";
import type { Branch } from "@/lib/ipc";

const AUTO_FETCH_THROTTLE_MS = 5 * 60_000;
const AUTO_FETCH_LRU_LIMIT = 16;

export type SourceControlRefreshMode = "auto" | "always" | "never";
export type SourceControlRemoteAction = "fetch" | "pull" | "push";
export type SourceControlRemoteActionMode =
  | "contextual"
  | SourceControlRemoteAction;

export interface SourceControlRemoteActionResult {
  ok: boolean;
  action: SourceControlRemoteAction | null;
  error?: string;
  blocked?: "diverged" | "missing-upstream" | "no-repo";
}

export interface SourceControlSummary {
  branch: Branch | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  hasRepo: boolean;
  isLoading: boolean;
  localError: string | null;
  busyAction: SourceControlRemoteAction | null;
  lastRemoteError: string | null;
  refresh: (options?: { remote?: SourceControlRefreshMode }) => Promise<void>;
  runRemoteAction: (
    mode?: SourceControlRemoteActionMode
  ) => Promise<SourceControlRemoteActionResult>;
}

export interface SourceControlRemoteIndicator {
  visible: boolean;
  label: string;
  title: string;
  disabled: boolean;
  action: SourceControlRemoteAction | null;
}

interface SourceControlState {
  branch: Branch | null;
  hasRepo: boolean;
  isLoading: boolean;
  localError: string | null;
  busyAction: SourceControlRemoteAction | null;
  lastRemoteError: string | null;
}

const EMPTY_STATE: SourceControlState = {
  branch: null,
  hasRepo: false,
  isLoading: false,
  localError: null,
  busyAction: null,
  lastRemoteError: null,
};

function normalizeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown source control error";
}

function getContextualAction(branch: Branch | null): SourceControlRemoteAction | null {
  if (!branch?.upstream) return null;
  const ahead = branch.ahead ?? 0;
  const behind = branch.behind ?? 0;
  if (ahead > 0 && behind > 0) return null;
  if (behind > 0) return "pull";
  if (ahead > 0) return "push";
  return "fetch";
}

export function getSourceControlRemoteIndicator(
  summary: Pick<
    SourceControlSummary,
    "hasRepo" | "upstream" | "ahead" | "behind" | "busyAction"
  >
): SourceControlRemoteIndicator {
  if (!summary.hasRepo || !summary.upstream) {
    return { visible: false, label: "", title: "", disabled: true, action: null };
  }
  if (summary.ahead > 0 && summary.behind > 0) {
    return {
      visible: true,
      label: `↑${summary.ahead} ↓${summary.behind}`,
      title:
        "Branch has diverged from upstream. Use Source Control or the terminal to resolve it.",
      disabled: true,
      action: null,
    };
  }
  if (summary.behind > 0) {
    return {
      visible: true,
      label: `↓${summary.behind}`,
      title: `Pull ${summary.behind} remote ${
        summary.behind === 1 ? "commit" : "commits"
      }.`,
      disabled: summary.busyAction !== null,
      action: "pull",
    };
  }
  if (summary.ahead > 0) {
    return {
      visible: true,
      label: `↑${summary.ahead}`,
      title: `Push ${summary.ahead} local ${
        summary.ahead === 1 ? "commit" : "commits"
      }.`,
      disabled: summary.busyAction !== null,
      action: "push",
    };
  }
  return {
    visible: true,
    label: "Sync",
    title: "Fetch remote updates.",
    disabled: summary.busyAction !== null,
    action: "fetch",
  };
}

// Module-level so the auto-fetch throttle window is shared across every
// workspace; the LRU caps memory when many worktrees are touched.
const autoFetchByPath = new Map<string, number>();

export function __resetAutoFetchForTests(): void {
  autoFetchByPath.clear();
}

function touchAutoFetch(key: string): void {
  autoFetchByPath.delete(key);
  autoFetchByPath.set(key, Date.now());
  while (autoFetchByPath.size > AUTO_FETCH_LRU_LIMIT) {
    const oldest = autoFetchByPath.keys().next().value;
    /* v8 ignore next — size > limit guarantees a key; defensive against a
       corrupted iterator. */
    if (oldest === undefined) break;
    autoFetchByPath.delete(oldest);
  }
}

function findCurrent(branches: Branch[]): Branch | null {
  return branches.find((b) => b.isCurrent) ?? null;
}

export function useSourceControl(
  worktreePath: string | null | undefined,
  enabled: boolean = true
): SourceControlSummary {
  const [state, setState] = useState<SourceControlState>(EMPTY_STATE);
  const stateRef = useRef(state);
  const requestIdRef = useRef(0);
  const inflightRef = useRef<Promise<void> | null>(null);
  const inflightModeRef = useRef<SourceControlRefreshMode>("never");
  const enabledRef = useRef(enabled);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    requestIdRef.current++;
    inflightRef.current = null;
    inflightModeRef.current = "never";
    setState(EMPTY_STATE);
  }, [worktreePath]);

  const doRefresh = useCallback(
    async (remoteMode: SourceControlRefreshMode): Promise<void> => {
      if (!enabledRef.current) return;
      const requestId = ++requestIdRef.current;

      if (!worktreePath) {
        setState(EMPTY_STATE);
        return;
      }

      setState((current) => ({ ...current, isLoading: true, localError: null }));

      try {
        let branch = findCurrent(await gitBranchList(worktreePath));
        if (requestId !== requestIdRef.current) return;

        if (!branch) {
          setState((current) => ({
            ...current,
            branch: null,
            hasRepo: true,
            isLoading: false,
            localError: null,
          }));
          return;
        }

        let fetchedError: string | null | undefined;
        const shouldAutoFetch =
          Boolean(branch.upstream) &&
          remoteMode !== "never" &&
          (remoteMode === "always" ||
            Date.now() - (autoFetchByPath.get(worktreePath) ?? 0) >=
              AUTO_FETCH_THROTTLE_MS);

        if (shouldAutoFetch) {
          try {
            await gitFetch(worktreePath);
            touchAutoFetch(worktreePath);
            fetchedError = null;
            if (requestId !== requestIdRef.current) return;
            branch = findCurrent(await gitBranchList(worktreePath)) ?? branch;
            if (requestId !== requestIdRef.current) return;
          } catch (error) {
            fetchedError = normalizeError(error);
          }
        }

        const resolvedBranch = branch;
        setState((current) => ({
          ...current,
          branch: resolvedBranch,
          hasRepo: true,
          isLoading: false,
          localError: null,
          // Preserve the prior remote error unless this refresh itself touched it.
          lastRemoteError:
            fetchedError === undefined ? current.lastRemoteError : fetchedError,
        }));
      } catch (error) {
        if (requestId !== requestIdRef.current) return;
        setState((current) => ({
          ...current,
          branch: null,
          hasRepo: false,
          isLoading: false,
          localError: normalizeError(error),
        }));
      }
    },
    [worktreePath]
  );

  const refresh = useCallback(
    async (options?: { remote?: SourceControlRefreshMode }) => {
      const remoteMode = options?.remote ?? "never";
      const inflight = inflightRef.current;
      if (inflight) {
        const cur = inflightModeRef.current;
        const upgrade =
          (cur === "never" && remoteMode !== "never") ||
          (cur === "auto" && remoteMode === "always");
        if (!upgrade) return inflight;
      }
      inflightModeRef.current = remoteMode;
      const run = doRefresh(remoteMode).finally(() => {
        if (inflightRef.current === run) {
          inflightRef.current = null;
          inflightModeRef.current = "never";
        }
      });
      inflightRef.current = run;
      return run;
    },
    [doRefresh]
  );

  const runRemoteAction = useCallback(
    async (
      mode: SourceControlRemoteActionMode = "contextual"
    ): Promise<SourceControlRemoteActionResult> => {
      const { branch } = stateRef.current;
      if (!worktreePath || !branch) {
        return { ok: false, action: null, blocked: "no-repo" };
      }
      if (!branch.upstream) {
        return { ok: false, action: null, blocked: "missing-upstream" };
      }

      const action = mode === "contextual" ? getContextualAction(branch) : mode;
      if (!action) {
        return { ok: false, action: null, blocked: "diverged" };
      }

      setState((current) => ({ ...current, busyAction: action }));

      try {
        if (action === "fetch") {
          await gitFetch(worktreePath);
          touchAutoFetch(worktreePath);
        } else if (action === "pull") {
          await gitPull(worktreePath);
          touchAutoFetch(worktreePath);
        } else {
          await gitPush(worktreePath);
        }
        setState((current) => ({ ...current, lastRemoteError: null }));
        await refresh({ remote: "never" });
        return { ok: true, action };
      } catch (error) {
        const message = normalizeError(error);
        setState((current) => ({ ...current, lastRemoteError: message }));
        await refresh({ remote: "never" }).catch(() => {});
        return { ok: false, action, error: message };
      } finally {
        setState((current) => ({ ...current, busyAction: null }));
      }
    },
    [worktreePath, refresh]
  );

  useEffect(() => {
    if (!enabled) {
      requestIdRef.current++;
      setState(EMPTY_STATE);
      return;
    }
    void refresh({ remote: "auto" });
    // `worktreePath` is intentionally omitted: it is already captured inside the
    // refresh→doRefresh closure, so `refresh` changes identity whenever the path
    // does. Listing it here too would let this effect race the line-178 reset
    // effect and briefly strand isLoading=true after a path change.
  }, [refresh, enabled]);

  return useMemo<SourceControlSummary>(
    () => ({
      branch: state.branch,
      upstream: state.branch?.upstream ?? null,
      ahead: state.branch?.ahead ?? 0,
      behind: state.branch?.behind ?? 0,
      hasRepo: state.hasRepo,
      isLoading: state.isLoading,
      localError: state.localError,
      busyAction: state.busyAction,
      lastRemoteError: state.lastRemoteError,
      refresh,
      runRemoteAction,
    }),
    [state, refresh, runRemoteAction]
  );
}
