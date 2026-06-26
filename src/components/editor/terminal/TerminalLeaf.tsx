import { useEffect, useState } from "react";
import { ptySpawn, ptyWrite } from "@/lib/tauri";
import { getGlobalEnv, getDefaultShellKind } from "@/lib/stores/settings";
import { resolveShell } from "@/lib/terminal-shell";
import { useLaunchSpec } from "@/hooks/useLaunchSpec";
import type { Workspace } from "@/lib/ipc";
import { TerminalPane } from "./TerminalPane";
import { leafPtyCache } from "./leaf-registry";

// Leaves whose preset `startup` line has already been typed, so a keep-alive
// remount (which reuses the cached PTY) never re-types it.
const startupWritten = new Set<string>();

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
  // Preset leaves carry a per-node launch: spawn `command` (in `cwd`) directly
  // via ConPTY and type `startup` into it once. Absent = the default shell.
  command?: string;
  args?: string[];
  cwd?: string;
  startup?: string;
}

/** A single terminal pane: a login shell (or a preset command) scoped to the worktree. */
export function TerminalLeaf({
  leafId,
  workspace,
  isFocused,
  onFocus,
  visible = true,
  command,
  args,
  cwd,
  startup,
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
    // A preset leaf spawns its own command/cwd; a normal leaf spawns the shell.
    const shellRes = resolveShell(getDefaultShellKind());
    const spawnCommand = command ?? shellRes.shell;
    const spawnArgs = command ? args ?? [] : shellRes.args;
    const spawnCwd = cwd ?? workspace.worktreePath;
    ptySpawn(spawnCommand, spawnArgs, spawnCwd, getGlobalEnv())
      .then(({ ptyId }) => {
        if (cancelled) return;
        leafPtyCache.set(leafId, ptyId);
        setState({ status: "ready", ptyId });
        // Type the preset's startup line once into the freshly-spawned command.
        if (startup && !startupWritten.has(leafId)) {
          startupWritten.add(leafId);
          void ptyWrite(ptyId, `${startup}\r`).catch(() => {});
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: "error", error: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [leafId, workspace.worktreePath, command, args, cwd, startup]);

  // Only the primary leaf launches the staged CLI; subsequently-split leaves are
  // bare shells. A preset leaf (own `command`) must NOT also consume a launch
  // spec, or it would type a second command into its agent.
  const runLaunchSpec = leafId === `${workspace.id}-1` && !command;
  useLaunchSpec(
    workspace,
    runLaunchSpec ? state.ptyId : undefined,
    runLaunchSpec && state.status === "ready"
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
      // #40l: evict the dead ptyId on a natural process exit so a later
      // keep-alive remount respawns a fresh PTY instead of binding a corpse.
      onExit={() => {
        leafPtyCache.delete(leafId);
        startupWritten.delete(leafId);
      }}
    />
  );
}
