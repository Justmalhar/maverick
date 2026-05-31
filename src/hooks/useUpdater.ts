import { useCallback, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "uptodate"
  | "available"
  | "installing"
  | "error"
  | "unconfigured";

export interface UpdaterState {
  status: UpdaterStatus;
  /** The pending update when status is "available", else null. */
  update: Update | null;
  /** Human-readable detail for the "error" status. */
  error: string | null;
}

/**
 * Heuristic for distinguishing "this build has no usable update channel yet"
 * (a dev-build / not-yet-published condition we degrade gracefully on) from a
 * genuine network/verification failure. Two shapes map to "unconfigured":
 *   1. Tauri's missing-config string (mentions the updater config or endpoints).
 *   2. A 404 / "not found" from a placeholder or pre-release endpoint — the
 *      manifest simply isn't published, which is the unconfigured case for the
 *      user, not a check failure worth surfacing as a red error row.
 */
function isUnconfigured(message: string): boolean {
  const m = message.toLowerCase();
  if (m.includes("404") || m.includes("not found") || m.includes("could not fetch")) {
    return true;
  }
  return (
    m.includes("updater") &&
    (m.includes("not configured") ||
      m.includes("no endpoint") ||
      m.includes("endpoints") ||
      m.includes("disabled"))
  );
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown updater error";
}

export interface UseUpdaterResult extends UpdaterState {
  checkNow: () => Promise<void>;
  installAndRestart: () => Promise<void>;
}

export function useUpdater(): UseUpdaterResult {
  const [state, setState] = useState<UpdaterState>({
    status: "idle",
    update: null,
    error: null,
  });

  const checkNow = useCallback(async () => {
    setState({ status: "checking", update: null, error: null });
    try {
      const result = await check();
      if (result) {
        setState({ status: "available", update: result, error: null });
      } else {
        setState({ status: "uptodate", update: null, error: null });
      }
    } catch (err) {
      const message = messageOf(err);
      if (isUnconfigured(message)) {
        setState({ status: "unconfigured", update: null, error: null });
      } else {
        setState({ status: "error", update: null, error: message });
      }
    }
  }, []);

  const installAndRestart = useCallback(async () => {
    if (!state.update) return;
    const pending = state.update;
    setState({ status: "installing", update: pending, error: null });
    try {
      await pending.downloadAndInstall();
      await relaunch();
    } catch (err) {
      setState({ status: "error", update: null, error: messageOf(err) });
    }
  }, [state.update]);

  return { ...state, checkNow, installAndRestart };
}
