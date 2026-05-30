import { useEffect, useRef, useState, useCallback } from "react";
import { ptySpawn, ptyKill, onPtyData, onPtyExit } from "@/lib/tauri";

export type ScriptState = "idle" | "running" | "exited";

const BUFFER_CAP = 256 * 1024;

export function useScriptRunner(
  workspaceId: string | null,
  cwd: string | null,
  script: string
) {
  const [state, setState] = useState<ScriptState>("idle");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [output, setOutput] = useState("");
  const ptyIdRef = useRef<string | null>(null);

  useEffect(() => {
    let off1: (() => void) | undefined;
    let off2: (() => void) | undefined;
    onPtyData(({ ptyId, data }) => {
      if (ptyId !== ptyIdRef.current) return;
      setOutput((prev) => {
        const next = prev + data;
        return next.length > BUFFER_CAP ? next.slice(next.length - BUFFER_CAP) : next;
      });
    })
      .then((fn) => {
        off1 = fn;
      })
      .catch(() => {});
    onPtyExit(({ ptyId, code }) => {
      if (ptyId !== ptyIdRef.current) return;
      setExitCode(code);
      setState("exited");
      ptyIdRef.current = null;
    })
      .then((fn) => {
        off2 = fn;
      })
      .catch(() => {});
    return () => {
      off1?.();
      off2?.();
    };
  }, []);

  const start = useCallback(async () => {
    if (!workspaceId || !script.trim()) return;
    setOutput("");
    setExitCode(null);
    setStartedAt(Date.now());
    const { ptyId } = await ptySpawn("/bin/sh", ["-c", script], cwd ?? undefined);
    ptyIdRef.current = ptyId;
    setState("running");
  }, [workspaceId, cwd, script]);

  const stop = useCallback(async () => {
    if (!ptyIdRef.current) return;
    const id = ptyIdRef.current;
    ptyIdRef.current = null;
    try {
      await ptyKill(id);
    /* v8 ignore next 3 */
    } catch {
      // idempotent: kill may race with natural exit
    }
  }, []);

  return { state, exitCode, startedAt, output, start, stop };
}
