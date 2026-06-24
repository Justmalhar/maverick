import { useEffect, useState } from "react";
import { ptySpawn } from "@/lib/tauri";
import { getGlobalEnv, getDefaultShellKind } from "@/lib/stores/settings";
import { resolveShell } from "@/lib/terminal-shell";
import { useLaunchSpec } from "@/hooks/useLaunchSpec";
import type { Workspace } from "@/lib/ipc";
import { TerminalPane } from "./TerminalPane";
import { leafPtyCache } from "./leaf-registry";

// Every workspace surface is a real shell now: each split leaf owns its OWN
// login-shell PTY scoped to the worktree. The workspace's primary leaf
// (`${workspace.id}-1`) additionally consumes the staged launch spec to start a
// CLI as a child of that shell (Ctrl-C returns to the prompt, not a dead pane).
// The live-PTY registry and its kill/lookup helpers live in ./leaf-registry so
// this file exports only the component (Fast Refresh requirement).

interface SpawnState {
  status: "spawning" | "ready" | "error";
  ptyId?: string;
  error?: string;
}

interface Props {
  leafId: string;
  workspace: Workspace;
  isFocused: boolean;
  onFocus: (paneId: string) => void;
  // False when the owning workspace editor is keep-alive-hidden — the pane
  // releases its xterm slot but keeps its shell PTY alive.
  visible?: boolean;
}

/** A single terminal pane: a login shell scoped to the workspace worktree. */
export function TerminalLeaf({
  leafId,
  workspace,
  isFocused,
  onFocus,
  visible = true,
}: Props) {
  const [state, setState] = useState<SpawnState>(() => {
    const cached = leafPtyCache.get(leafId);
    return cached ? { status: "ready", ptyId: cached } : { status: "spawning" };
  });

  useEffect(() => {
    const cached = leafPtyCache.get(leafId);
    if (cached) {
      setState({ status: "ready", ptyId: cached });
      return;
    }
    let cancelled = false;
    setState({ status: "spawning" });
    const { shell, args } = resolveShell(getDefaultShellKind());
    ptySpawn(shell, args, workspace.worktreePath, getGlobalEnv())
      .then(({ ptyId }) => {
        if (cancelled) return;
        leafPtyCache.set(leafId, ptyId);
        setState({ status: "ready", ptyId });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: "error", error: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [leafId, workspace.worktreePath]);

  // Only the primary leaf launches the staged CLI; subsequently-split leaves are
  // bare shells. The hook is a no-op for non-primary leaves (ready stays false).
  const isPrimary = leafId === `${workspace.id}-1`;
  useLaunchSpec(
    workspace,
    isPrimary ? state.ptyId : undefined,
    isPrimary && state.status === "ready"
  );

  if (state.status === "error") {
    return (
      <div
        data-testid={`terminal-leaf-error-${leafId}`}
        className="flex h-full w-full items-center justify-center px-4 text-center text-xs text-destructive"
      >
        Failed to start terminal: {state.error}
      </div>
    );
  }

  if (state.status !== "ready" || !state.ptyId) {
    return (
      <div
        data-testid={`terminal-leaf-loading-${leafId}`}
        className="flex h-full w-full items-center justify-center text-xs text-muted-foreground"
      >
        Starting shell…
      </div>
    );
  }

  return (
    <TerminalPane
      ptyId={state.ptyId}
      paneId={leafId}
      isFocused={isFocused}
      onFocus={onFocus}
      visible={visible}
    />
  );
}
