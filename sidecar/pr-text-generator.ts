import { defaultShell } from "./deps";
import { DEFAULT_ONESHOT, type OneShotSpec } from "./agent-oneshot";
import { sanitizeCommitMessage } from "./commit-message";
import type { Shell } from "./types";

const MAX_CHARS = 6_000;
const TIMEOUT_MS = 150_000;

const HEADER =
  "Write a pull request title and description for the changes below. " +
  "First line: a concise title (<=72 chars, no prefix, no quotes). " +
  "Then a blank line, then a short markdown description of what changed and why. " +
  "Reply with the title and description only — no preamble, no code fences.";

export interface PrTextParams {
  worktreePath: string;
  base: string;
  instructions?: string;
  agent?: OneShotSpec;
}

export class PrTextGenerator {
  private shell: Shell;

  constructor(opts: { shell?: Shell } = {}) {
    this.shell = opts.shell ?? defaultShell;
  }

  async generate(params: PrTextParams): Promise<{ title: string; body: string }> {
    const agent = params.agent ?? DEFAULT_ONESHOT;
    const subjects = await this.shell.text(
      ["git", "-C", params.worktreePath, "log", `${params.base}..HEAD`, "--pretty=format:%s"],
      undefined
    );
    const stat = await this.shell.text(
      ["git", "-C", params.worktreePath, "diff", "--stat", `${params.base}..HEAD`],
      undefined
    );
    const guidance = params.instructions?.trim()
      ? `\n\nProject convention: ${params.instructions.trim()}`
      : "";
    const prompt =
      `${HEADER}${guidance}\n\nCommits:\n${subjects.trim()}\n\nFiles:\n${stat.trim()}`.slice(
        0,
        MAX_CHARS
      );

    const { stdout, stderr, exitCode } = await this.shell.run(
      [agent.command, ...agent.args],
      params.worktreePath,
      prompt,
      { timeoutMs: TIMEOUT_MS }
    );
    if (exitCode !== 0) {
      throw new Error(stderr.trim() || "agent CLI failed — is it installed and logged in?");
    }
    return PrTextGenerator.split(stdout);
  }

  // Reuse the commit-message sanitizer to clean the whole block, then split the
  // first line off as the title and keep the remainder as the body.
  static split(raw: string): { title: string; body: string } {
    const cleaned = sanitizeCommitMessage(raw);
    const nl = cleaned.indexOf("\n");
    if (nl === -1) return { title: cleaned, body: "" };
    return { title: cleaned.slice(0, nl).trim(), body: cleaned.slice(nl + 1).trim() };
  }
}
