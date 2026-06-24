import { useWorkbench } from "@/state/store";

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
