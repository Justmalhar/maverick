import { useEffect, useState } from "react";
import { ptySpawn, ptyKill } from "@/lib/tauri";
import { getGlobalEnv } from "@/lib/stores/settings";
import type { Workspace } from "@/lib/ipc";
import { TerminalPane } from "./TerminalPane";

// Terminal Mode panes run a login shell in the workspace worktree (mirrors
// the Panel's Terminal tab). Each split leaf owns its OWN shell PTY — they are
// not the agent CLI, which is Agent Mode (AgentTerminal).
const LEAF_SHELL = "/bin/zsh";
const LEAF_ARGS = ["-l"];

interface SpawnState {
  status: "spawning" | "ready" | "error";
  ptyId?: string;
  error?: string;
}

// Keyed by split-leaf id so a pane's shell survives splits / remounts / tab
// switches. The SplitNode.ptyId field is no longer the source of truth for the
// live PTY — this cache is. Entries are evicted by killLeaf() on pane close.
const leafPtyCache = new Map<string, string>();

/** Kill and evict a terminal-mode leaf's shell PTY. Called when a pane closes. */
export function killLeaf(leafId: string): void {
  const ptyId = leafPtyCache.get(leafId);
  if (!ptyId) return;
  leafPtyCache.delete(leafId);
  void ptyKill(ptyId).catch(() => {});
}

/** Kill every terminal-mode leaf PTY belonging to a workspace (ids are `${workspaceId}-…`). */
export function killWorkspaceLeaves(workspaceId: string): void {
  const prefix = `${workspaceId}-`;
  for (const leafId of [...leafPtyCache.keys()]) {
    if (leafId.startsWith(prefix)) killLeaf(leafId);
  }
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

/** A single Terminal-Mode pane: a login shell scoped to the workspace worktree. */
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
    ptySpawn(LEAF_SHELL, LEAF_ARGS, workspace.worktreePath, getGlobalEnv())
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

export const __testing__ = { leafPtyCache };
