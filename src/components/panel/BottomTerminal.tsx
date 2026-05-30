import { useEffect, useState } from "react";
import { Terminal } from "lucide-react";
import { useWorkbench, selectActiveWorkspace } from "@/state/store";
import { ptySpawn } from "@/lib/tauri";
import { TerminalPane } from "@/components/editor/terminal/TerminalPane";

const DEFAULT_SHELL = "/bin/zsh";
const DEFAULT_ARGS = ["-l"];

interface SpawnState {
  status: "idle" | "spawning" | "ready" | "error";
  ptyId?: string;
  error?: string;
}

const ptyCache = new Map<string, string>();

export function BottomTerminal() {
  const ws = useWorkbench(selectActiveWorkspace);
  const [state, setState] = useState<SpawnState>({ status: "idle" });

  useEffect(() => {
    if (!ws) {
      setState({ status: "idle" });
      return;
    }
    const cached = ptyCache.get(ws.id);
    if (cached) {
      setState({ status: "ready", ptyId: cached });
      return;
    }
    let cancelled = false;
    setState({ status: "spawning" });
    ptySpawn(DEFAULT_SHELL, DEFAULT_ARGS, ws.worktreePath)
      .then(({ ptyId }) => {
        if (cancelled) return;
        ptyCache.set(ws.id, ptyId);
        setState({ status: "ready", ptyId });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: "error", error: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [ws]);

  if (!ws) {
    return (
      <div
        data-testid="bottom-terminal-empty"
        className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center"
      >
        <Terminal className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
        <span className="text-[13px] text-foreground">Terminal</span>
        <p className="max-w-md text-xs text-muted-foreground">
          Open a workspace from a project to start a shell scoped to its worktree.
        </p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        data-testid="bottom-terminal-error"
        className="flex h-full items-center justify-center px-4 text-center text-xs text-destructive"
      >
        Failed to start terminal: {state.error}
      </div>
    );
  }

  if (state.status !== "ready" || !state.ptyId) {
    return (
      <div
        data-testid="bottom-terminal-loading"
        className="flex h-full items-center justify-center text-xs text-muted-foreground"
      >
        Starting shell in {ws.worktreePath}…
      </div>
    );
  }

  return (
    <div data-testid="bottom-terminal" className="h-full w-full bg-background">
      <TerminalPane
        ptyId={state.ptyId}
        paneId={`bottom-${ws.id}`}
        isFocused
        onFocus={() => {}}
      />
    </div>
  );
}

export const __testing__ = { ptyCache };
