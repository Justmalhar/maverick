import { useCallback, useSyncExternalStore } from "react";
import {
  getRunnerSnapshot,
  runnerKey,
  startRunner,
  stopRunner,
  subscribeRunner,
  type ScriptKind,
  type ScriptSnapshot,
  type ScriptState,
} from "@/lib/script-runner";

export type { ScriptState };

const IDLE: ScriptSnapshot = { state: "idle", exitCode: null, startedAt: null, output: "" };
const NOOP = () => () => {};

// Thin React binding over the keep-alive script-runner registry. The live PTY,
// output buffer, and state live in the registry (src/lib/script-runner.ts), so
// they survive this hook's component unmounting — see that file's header.
export function useScriptRunner(
  workspaceId: string | null,
  cwd: string | null,
  script: string,
  kind: ScriptKind
) {
  const key = workspaceId ? runnerKey(workspaceId, kind) : null;

  const snapshot = useSyncExternalStore(
    key ? (cb) => subscribeRunner(key, cb) : NOOP,
    () => (key ? getRunnerSnapshot(key) : IDLE)
  );

  const start = useCallback(async () => {
    if (!key || !workspaceId || !script.trim()) return;
    await startRunner(key, script, cwd);
  }, [key, workspaceId, script, cwd]);

  const stop = useCallback(async () => {
    if (!key) return;
    await stopRunner(key);
  }, [key]);

  return {
    state: snapshot.state,
    exitCode: snapshot.exitCode,
    startedAt: snapshot.startedAt,
    output: snapshot.output,
    start,
    stop,
  };
}
