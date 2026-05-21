// PTY lifecycle + TerminalProvider binding (renderer-agnostic).
// Subscribes to pty:data and pty:exit Tauri events, forwarding bytes
// to the provider handle attached via attach().
import { useCallback, useEffect, useRef } from "react";
import type { TerminalHandle } from "@/lib/terminal-provider";
import { onPtyData, onPtyExit, ptyWrite, ptyResize } from "@/lib/tauri";

export function usePty(ptyId: string) {
  const handleRef = useRef<TerminalHandle | null>(null);

  const attach = useCallback((h: TerminalHandle | null) => {
    handleRef.current = h;
  }, []);

  useEffect(() => {
    if (!ptyId) return;
    const unlistenData = onPtyData(({ ptyId: id, data }) => {
      if (id === ptyId) handleRef.current?.write(data);
    });
    const unlistenExit = onPtyExit(({ ptyId: id }) => {
      if (id === ptyId) handleRef.current?.dispose();
    });
    return () => {
      unlistenData.then((u) => u()).catch(() => {});
      unlistenExit.then((u) => u()).catch(() => {});
    };
  }, [ptyId]);

  const write = useCallback(
    (data: string) => (ptyId ? ptyWrite(ptyId, data) : Promise.resolve()),
    [ptyId]
  );

  const resize = useCallback(
    (cols: number, rows: number) =>
      ptyId ? ptyResize(ptyId, cols, rows) : Promise.resolve(),
    [ptyId]
  );

  return { attach, write, resize, handle: handleRef.current };
}
