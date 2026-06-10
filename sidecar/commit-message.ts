import { defaultShell } from "./deps";
import type { Shell } from "./types";

// Keep the prompt well under CLI arg/context limits; --shortstat + the head of
// the patch is enough signal for a one-line conventional commit message.
const MAX_DIFF_CHARS = 6_000;

const PROMPT_HEADER =
  "Write a conventional commit message (type(scope): summary, <=72 chars first line) " +
  "for the following git changes. Reply with the commit message only — no quotes, " +
  "no markdown, no explanation.";

export class CommitMessageGenerator {
  private shell: Shell;

  constructor(opts: { shell?: Shell } = {}) {
    this.shell = opts.shell ?? defaultShell;
  }

  async generate(params: { worktreePath: string }): Promise<{ message: string }> {
    const stat = await this.shell.text(
      ["git", "-C", params.worktreePath, "diff", "HEAD", "--stat"],
      undefined
    );
    if (!stat.trim()) throw new Error("no changes to describe");

    const diff = await this.shell.text(
      ["git", "-C", params.worktreePath, "diff", "HEAD"],
      undefined
    );
    const prompt = `${PROMPT_HEADER}\n\n${stat.trim()}\n\n${diff.slice(0, MAX_DIFF_CHARS)}`;

    // The claude CLI authenticates from ~/.claude.json — Maverick never holds keys.
    const { stdout, stderr, exitCode } = await this.shell.run(
      ["claude", "-p", "--output-format", "text"],
      params.worktreePath,
      prompt
    );
    if (exitCode !== 0) {
      throw new Error(stderr.trim() || "claude CLI failed — is it installed and logged in?");
    }
    const message = stdout.trim();
    if (!message) throw new Error("claude CLI returned an empty message");
    return { message };
  }
}
