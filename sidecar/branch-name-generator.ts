import { defaultShell } from "./deps";
import type { Shell } from "./types";

// Generates a concise feature name for a workspace branch from the task text,
// via the same `claude -p` path the commit-message generator uses (the CLI
// authenticates from ~/.claude.json — Maverick never holds keys). The caller
// substitutes the result into the naming scheme and falls back to a title slug
// if this fails or is slow, so a missing/slow CLI never blocks workspace create.
const PROMPT =
  "Suggest a git branch feature name for the task below: 2-4 words, lowercase, " +
  "kebab-case, no slashes or prefixes. Reply with ONLY the name, nothing else.";

const MAX_TASK_CHARS = 2_000;

export class BranchNameGenerator {
  private shell: Shell;

  constructor(opts: { shell?: Shell } = {}) {
    this.shell = opts.shell ?? defaultShell;
  }

  async generate(params: { prompt: string; cwd?: string }): Promise<{ name: string }> {
    const input = `${PROMPT}\n\nTask:\n${params.prompt.slice(0, MAX_TASK_CHARS)}`;
    const { stdout, stderr, exitCode } = await this.shell.run(
      ["claude", "-p", "--output-format", "text"],
      params.cwd,
      input
    );
    if (exitCode !== 0) {
      throw new Error(stderr.trim() || "claude CLI failed — is it installed and logged in?");
    }
    const name = stdout.trim();
    if (!name) throw new Error("claude CLI returned an empty name");
    return { name };
  }
}
