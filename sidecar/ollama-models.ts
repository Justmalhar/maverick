import { defaultShell } from "./deps";
import type { AgentModelOption, Shell } from "./types";

export interface OllamaModelsOptions {
  shell?: Shell;
}

export class OllamaModels {
  private shell: Shell;

  constructor(opts: OllamaModelsOptions = {}) {
    this.shell = opts.shell ?? defaultShell;
  }

  async list(): Promise<AgentModelOption[]> {
    let output: string;
    try {
      output = await this.shell.text(["ollama", "list"], undefined);
    } catch {
      return [];
    }
    return OllamaModels.parse(output);
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
