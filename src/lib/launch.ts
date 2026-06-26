import { useWorkbench } from "@/state/store";
import { getStartupCommand } from "@/lib/stores/settings";

// Resolves the launch command for a backend id when a workspace is created, so
// the agent CLI (e.g. `claude`) starts automatically in the terminal instead of
// the user typing it every time. Prefers the backend's configured command in
// the store; falls back to this map, then the id itself.
export const BACKEND_COMMAND_FALLBACK: Record<string, string> = {
  "claude-code": "claude",
  codex: "codex",
  gemini: "gemini",
  aider: "aider",
  ollama: "ollama",
};

export function resolveLaunch(backendId: string): { command: string; args: string[] } {
  const backend = useWorkbench.getState().backends.find((b) => b.id === backendId);
  return {
    command: backend?.command ?? BACKEND_COMMAND_FALLBACK[backendId] ?? backendId,
    args: backend?.args ?? [],
  };
}

/** Split a command line into command + args on whitespace (no quote handling). */
export function parseCommandLine(line: string): { command: string; args: string[] } {
  const parts = line.trim().split(/\s+/).filter(Boolean);
  return { command: parts[0] ?? "", args: parts.slice(1) };
}

/**
 * The command to auto-run when a workspace is created. Prefers the user's
 * configured `general.startupCommand` (e.g. "claude --dangerously-skip-
 * permissions") so they don't retype it every time; otherwise the backend's
 * default command.
 */
export function resolveStartupLaunch(backendId: string): { command: string; args: string[] } {
  const custom = getStartupCommand();
  if (custom.trim()) return parseCommandLine(custom);
  return resolveLaunch(backendId);
}
