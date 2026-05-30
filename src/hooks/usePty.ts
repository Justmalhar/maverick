// PTY lifecycle + TerminalProvider binding (renderer-agnostic).
// Subscribes to pty:data and pty:exit Tauri events, forwarding bytes
// to the bound renderer (mount handle) or — in the pooled path — to the leaf's
// session, which writes to its slot if bound, else its DormantRing.
import { useCallback, useEffect, useRef } from "react";
import type { TerminalHandle } from "@/lib/terminal-provider";
import { onPtyData, onPtyExit, ptyWrite, ptyResize } from "@/lib/tauri";

interface PtyOptions {
  // Pooled path: route pty:data here instead of to a mounted handle. When the
  // leaf is dormant this lands in its DormantRing; when bound, on its slot.
  feed?: (data: string) => void;
  // Pooled path: invoked on pty:exit so the session can mark the shell exited.
  onExit?: (code: number) => void;
}

export function usePty(ptyId: string, options?: PtyOptions) {
  const handleRef = useRef<TerminalHandle | null>(null);
  const optsRef = useRef(options);
  optsRef.current = options;

  const attach = useCallback((h: TerminalHandle | null) => {
    handleRef.current = h;
  }, []);

  useEffect(() => {
    if (!ptyId) return;
    const unlistenData = onPtyData(({ ptyId: id, data }) => {
      if (id !== ptyId) return;
      const feed = optsRef.current?.feed;
      if (feed) feed(data);
      else handleRef.current?.write(data);
    });
    const unlistenExit = onPtyExit(({ ptyId: id, code }) => {
      if (id !== ptyId) return;
      const onExit = optsRef.current?.onExit;
      if (onExit) onExit(code);
      else handleRef.current?.dispose();
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

  // SIGWINCH kick: bump rows +1 then restore so the kernel actually emits a
  // winsize change and a dormant alt-screen TUI repaints from scratch.
  const kick = useCallback(
    (cols: number, rows: number) => {
      if (!ptyId || cols <= 0 || rows <= 0) return Promise.resolve();
      return ptyResize(ptyId, cols, rows + 1)
        .then(() => ptyResize(ptyId, cols, rows))
        .catch(() => {});
    },
    [ptyId]
  );

  return { attach, write, resize, kick, handle: handleRef.current };
}
