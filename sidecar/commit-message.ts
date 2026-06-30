import { defaultShell } from "./deps";
import { DEFAULT_ONESHOT, type OneShotSpec } from "./agent-oneshot";
import type { Shell } from "./types";

const MAX_DIFF_CHARS = 6_000;
const CLAUDE_TIMEOUT_MS = 150_000;

const PROMPT_HEADER =
  "Write a conventional commit message (type(scope): summary, <=72 chars first line) " +
  "for the following git changes. Reply with the commit message only — no quotes, " +
  "no markdown, no explanation.";

const PREAMBLE = /^(here(?:'s| is)\b.*|commit message\s*[:=]?|suggested commit.*|sure[,!.].*)$/i;

// Coerce model output into just the commit message: strip a wrapping ``` fence,
// a single leading preamble line ("Here is the commit message:"), and surrounding
// quotes/backticks — while preserving a legitimate multi-line subject + body.
export function sanitizeCommitMessage(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  if (fence) text = fence[1].trim();
  const lines = text.split("\n");
  if (lines.length > 1 && PREAMBLE.test(lines[0].trim())) {
    lines.shift();
    while (lines.length && lines[0].trim() === "") lines.shift();
    text = lines.join("\n").trim();
  }
  text = text.replace(/^[`'"]+|[`'"]+$/g, "").trim();
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

export class CommitMessageGenerator {
  private shell: Shell;

  constructor(opts: { shell?: Shell } = {}) {
    this.shell = opts.shell ?? defaultShell;
  }

  async generate(params: { worktreePath: string; agent?: OneShotSpec }): Promise<{ message: string }> {
    const agent = params.agent ?? DEFAULT_ONESHOT;
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

    const { stdout, stderr, exitCode } = await this.shell.run(
      [agent.command, ...agent.args],
      params.worktreePath,
      prompt,
      { timeoutMs: CLAUDE_TIMEOUT_MS }
    );
    if (exitCode !== 0) {
      throw new Error(stderr.trim() || "claude CLI failed — is it installed and logged in?");
    }
    const message = sanitizeCommitMessage(stdout);
    if (!message) throw new Error("agent CLI returned an empty message");
    return { message };
  }
}
