import { useEffect } from "react";
import { useWorkbench } from "@/state/store";
import { ptyWrite, onPtyData, onPtyExit, hooksClaudeSettingsPath } from "@/lib/tauri";
import {
  buildLaunchCommandLine,
  wrapBracketedPaste,
  IdleWatcher,
  type LaunchShell,
} from "@/lib/terminal-launch";
import { getDefaultShellKind } from "@/lib/stores/settings";
import { isWindows } from "@/lib/terminal-shell";
import { recordUsageEstimate } from "@/hooks/useContextUsage";
import { useAgentStatusStore, useAgentStatusReporter } from "@/hooks/useAgentStatus";
import type { LaunchSpec, Workspace } from "@/lib/ipc";

// Workspaces whose staged launch spec has already been consumed. Module-level so
// keep-alive remounts and tab switches never re-fire a launch for the same
// workspace (the spec is single-shot in the store, but a remount can happen
// before the consuming render's store delete is observed elsewhere).
const launched = new Set<string>();

/** Test-only: forget every recorded launch so each test starts clean. */
export function __resetLaunchedForTests(): void {
  launched.clear();
}

/**
 * The shell the primary leaf runs, which decides launch-command quoting. The
 * primary leaf spawns under the global default-shell setting (see TerminalLeaf),
 * so we mirror that here. WSL runs a POSIX shell inside, hence "posix".
 */
function launchShell(): LaunchShell {
  if (!isWindows()) return "posix";
  const kind = getDefaultShellKind();
  if (kind === "cmd") return "cmd";
  if (kind === "wsl") return "posix";
  return "powershell";
}

/** True when a launch command invokes the Claude Code CLI (bare, pathed, .cmd/.exe). */
export function isClaudeLaunchCommand(command: string): boolean {
  const base = command.split(/[\\/]/).pop() ?? command;
  return /^claude(\.cmd|\.exe)?$/i.test(base);
}

/**
 * Drives the terminal-first launch flow for a workspace's PRIMARY leaf. When its
 * shell PTY first becomes ready, the staged {@link LaunchSpec} is consumed once,
 * the CLI command is typed into the shell, and — if a prompt is staged — the
 * prompt is bracketed-pasted after the CLI's output goes idle. Output and exit on
 * that PTY drive the per-workspace agent-status pill, and the staged prompt seeds
 * the session's usage estimate.
 *
 * No-op when `ptyId` is undefined or `ready` is false. Non-primary leaves must
 * never call this — only `${workspace.id}-1` consumes the spec.
 */
export function useLaunchSpec(workspace: Workspace, ptyId: string | undefined, ready: boolean): void {
  const sessionId = workspace.sessionId;
  const backend = workspace.agentBackend;
  const workspaceId = workspace.id;
  const { reportOutput, markExit } = useAgentStatusReporter(workspaceId);

  useEffect(() => {
    if (!ready || !ptyId) return;
    if (launched.has(workspaceId)) return;
    const spec: LaunchSpec | null = useWorkbench.getState().consumeLaunchSpec(workspaceId);
    if (!spec) return;
    launched.add(workspaceId);

    useAgentStatusStore.getState().setStatus(workspaceId, "working");
    void (async () => {
      let args = spec.args;
      if (isClaudeLaunchCommand(spec.command)) {
        try {
          const { path } = await hooksClaudeSettingsPath(workspaceId);
          args = ["--settings", path, ...spec.args];
        } catch {
          // Fail open: launch Claude without hook notifications rather than block.
        }
      }
      await ptyWrite(ptyId, buildLaunchCommandLine({ ...spec, args }, launchShell()));
    })().catch(() => {});

    let watcher: IdleWatcher | null = null;
    if (spec.prompt !== undefined && spec.prompt !== "") {
      const prompt = spec.prompt;
      watcher = new IdleWatcher({
        onFire: () => {
          void ptyWrite(ptyId, wrapBracketedPaste(prompt)).catch(() => {});
        },
      });
      if (sessionId) {
        void recordUsageEstimate(sessionId, [{ content: prompt }], backend).catch(() => {});
      }
    }

    let cancelled = false;
    const unlistenData = onPtyData(({ ptyId: id, data }) => {
      if (id !== ptyId || cancelled) return;
      watcher?.push();
      reportOutput(data);
    });
    const unlistenExit = onPtyExit(({ ptyId: id, code }) => {
      if (id !== ptyId || cancelled) return;
      markExit(code);
    });

    return () => {
      cancelled = true;
      watcher?.cancel();
      void unlistenData.then((un) => un()).catch(() => {});
      void unlistenExit.then((un) => un()).catch(() => {});
    };
  }, [ready, ptyId, workspaceId, sessionId, backend, reportOutput, markExit]);
}
