import { useEffect, useState } from "react";
import { useWorkbench } from "@/state/store";
import { ptySpawn, ptyKill } from "@/lib/tauri";
import type { Workspace } from "@/lib/ipc";
import { TerminalPane } from "@/components/editor/terminal/TerminalPane";

interface Props {
  workspace: Workspace;
}

// Fallback command for a backend id when detection hasn't populated the store
// (mirrors the Rust KNOWN_BACKENDS table).
const FALLBACK_COMMAND: Record<string, string> = {
  "claude-code": "claude",
  codex: "codex",
  gemini: "gemini",
  aider: "aider",
  ollama: "ollama",
};

interface SpawnState {
  status: "idle" | "spawning" | "ready" | "error";
  ptyId?: string;
  error?: string;
}

// Keyed by workspace id so the agent process survives tab switches / remounts.
const agentPtyCache = new Map<string, string>();

/** Kill and evict a workspace's agent-CLI PTY. Called when the workspace is destroyed. */
export function killAgentPty(workspaceId: string): void {
  const ptyId = agentPtyCache.get(workspaceId);
  if (!ptyId) return;
  agentPtyCache.delete(workspaceId);
  void ptyKill(ptyId).catch(() => {});
}

/** Live terminal running the workspace's backend CLI in its worktree. */
export function AgentTerminal({ workspace }: Props) {
  const backend = useWorkbench((s) => s.backends.find((b) => b.id === workspace.agentBackend));
  const [state, setState] = useState<SpawnState>({ status: "idle" });

  useEffect(() => {
    const cached = agentPtyCache.get(workspace.id);
    if (cached) {
      setState({ status: "ready", ptyId: cached });
      return;
    }
    const command =
      backend?.command ?? FALLBACK_COMMAND[workspace.agentBackend] ?? workspace.agentBackend;
    const args = backend?.args ?? [];
    let cancelled = false;
    setState({ status: "spawning" });
    ptySpawn(command, args, workspace.worktreePath, backend?.env)
      .then(({ ptyId }) => {
        if (cancelled) return;
        agentPtyCache.set(workspace.id, ptyId);
        setState({ status: "ready", ptyId });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: "error", error: String(err) });
      });
    return () => {
      cancelled = true;
    };
    // Spawn once per workspace; the backend command is resolved at first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id, workspace.worktreePath, workspace.agentBackend]);

  if (state.status === "error") {
    return (
      <div
        data-testid={`agent-terminal-error-${workspace.id}`}
        className="flex h-full items-center justify-center px-4 text-center text-xs text-destructive"
      >
        Failed to start {workspace.agentBackend}: {state.error}
      </div>
    );
  }

  if (state.status !== "ready" || !state.ptyId) {
    return (
      <div
        data-testid={`agent-terminal-loading-${workspace.id}`}
        className="flex h-full items-center justify-center text-xs text-muted-foreground"
      >
        Starting {workspace.agentBackend}…
      </div>
    );
  }

  return (
    <div
      data-testid={`agent-terminal-${workspace.id}`}
      className="h-full w-full bg-background"
    >
      <TerminalPane
        ptyId={state.ptyId}
        paneId={`agent-${workspace.id}`}
        isFocused
        onFocus={() => {}}
      />
    </div>
  );
}

export const __testing__ = { agentPtyCache };
