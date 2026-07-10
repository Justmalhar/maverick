import { defaultShell } from "./deps";
import type { AgentModelOption, Shell } from "./types";

// `ollama list` talks to the local daemon; if it's running but unresponsive
// this caps the hang instead of blocking the sidecar's serial RPC loop.
// Mirrors GH_TIMEOUT_MS in checks-module.ts.
const OLLAMA_TIMEOUT_MS = 30_000;

export interface OllamaModelsOptions {
  shell?: Shell;
}

export class OllamaModels {
  private shell: Shell;

  constructor(opts: OllamaModelsOptions = {}) {
    this.shell = opts.shell ?? defaultShell;
  }

  async list(): Promise<AgentModelOption[]> {
    let result: { stdout: string; stderr: string; exitCode: number };
    try {
      // timeoutMs kills a stalled ollama daemon call instead of hanging the serial RPC loop.
      result = await this.shell.run(["ollama", "list"], undefined, undefined, {
        timeoutMs: OLLAMA_TIMEOUT_MS,
      });
    } catch {
      // ENOENT (ollama not installed): treat as unavailable.
      return [];
    }

    if (result.exitCode !== 0) {
      // Daemon unreachable or other failure: treat as unavailable.
      return [];
    }

    return OllamaModels.parse(result.stdout);
  }

  static parse(output: string): AgentModelOption[] {
    const lines = output.trim().split("\n");
    if (lines.length <= 1) return [];
    return lines
      .slice(1)
      .map((line) => line.trim().split(/\s+/)[0])
      .filter((name): name is string => Boolean(name))
      .map((name) => ({ id: name, label: name }));
  }
}
