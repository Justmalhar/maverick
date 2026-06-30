// Maps a configured backend id to its non-interactive ("read prompt from stdin,
// print the answer to stdout") invocation, so AI helpers (commit message, branch
// name, PR text) run under the agent the user configured rather than always
// claude. The prompt is always delivered over stdin by the callers. Backends with
// no known/safe one-shot mode (aider, ollama-without-model, anything unrecognized)
// fall back to claude — the dominant, always-correct case — so resolution never
// regresses an existing workflow.
export interface OneShotSpec {
  command: string;
  args: string[];
}

const CLAUDE: OneShotSpec = { command: "claude", args: ["-p", "--output-format", "text"] };

export function oneShotSpecFor(backend?: string): OneShotSpec {
  switch ((backend ?? "").toLowerCase()) {
    case "codex":
      return { command: "codex", args: ["exec"] };
    case "gemini":
      return { command: "gemini", args: [] };
    case "claude":
    case "claude-code":
    case "":
    default:
      return CLAUDE;
  }
}

export const DEFAULT_ONESHOT = CLAUDE;
