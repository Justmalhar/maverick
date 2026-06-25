import { defaultShell } from "./deps";
import type { Shell } from "./types";

// Generates a concise branch name for a workspace from the task text, via the
// same `claude -p` path the commit-message generator uses (the CLI authenticates
// from ~/.claude.json — Maverick never holds keys). The caller falls back to a
// title slug if this fails or is slow, so a missing/slow CLI never blocks
// workspace create.
const BASE_PROMPT =
  "Output ONLY a git branch name for the task below — nothing else. " +
  "No sentences, no explanation, no quotes, no trailing punctuation. " +
  "Examples of valid output: fix-login-redirect, add-export-button.";
// Used when the project has no branch-naming preference of its own.
const DEFAULT_RULES = "Use 2-4 words, lowercase, kebab-case, no slashes or prefixes.";

const MAX_TASK_CHARS = 2_000;

// Reap a hung `claude -p` before the Rust transport's 60s budget for
// ai.branch_name expires, so the child never outlives the request.
const CLAUDE_TIMEOUT_MS = 45_000;

// Deterministic guards so a model that ignores the prompt and returns prose
// (observed: a full explanatory sentence) is rejected and the caller falls back
// to a clean title slug rather than creating a 100-char garbage branch.
const MAX_BRANCH_LEN = 50;
const MAX_BRANCH_WORDS = 8;

export interface GenerateParams {
  prompt: string;
  cwd?: string;
  // Freeform project preference (settings → Preferences → Branch rename), e.g.
  // "always use feature/feature-name". When present it replaces DEFAULT_RULES so
  // the model can return a full convention-following name (slashes allowed).
  instructions?: string;
}

export class BranchNameGenerator {
  private shell: Shell;

  constructor(opts: { shell?: Shell } = {}) {
    this.shell = opts.shell ?? defaultShell;
  }

  async generate(params: GenerateParams): Promise<{ name: string }> {
    const rules = params.instructions?.trim()
      ? `Follow this naming convention: ${params.instructions.trim()}. Still output ONLY the branch name.`
      : DEFAULT_RULES;
    const input = `${BASE_PROMPT} ${rules}\n\nTask:\n${params.prompt.slice(0, MAX_TASK_CHARS)}`;
    const { stdout, stderr, exitCode } = await this.shell.run(
      ["claude", "-p", "--output-format", "text"],
      params.cwd,
      input,
      { timeoutMs: CLAUDE_TIMEOUT_MS }
    );
    if (exitCode !== 0) {
      throw new Error(stderr.trim() || "claude CLI failed — is it installed and logged in?");
    }
    const name = BranchNameGenerator.sanitizeBranchName(stdout);
    if (!name) throw new Error("claude CLI returned an empty name");
    return { name };
  }

  /**
   * Name a branch from the work already done in it (last commit subject + changed
   * files), for the "let AI name it later" flow. Reuses generate()'s prompt +
   * sanitize + instructions path. Falls back to a generic summary if git is quiet.
   */
  async generateFromDiff(params: { cwd: string; instructions?: string }): Promise<{ name: string }> {
    const summary = await this.diffSummary(params.cwd);
    return this.generate({ prompt: summary, cwd: params.cwd, instructions: params.instructions });
  }

  private async diffSummary(cwd: string): Promise<string> {
    const subject = (
      await this.shell.text(["git", "-C", cwd, "log", "-1", "--format=%s"], undefined).catch(() => "")
    ).trim();
    const stat = (
      await this.shell.text(["git", "-C", cwd, "diff", "--stat", "HEAD~1..HEAD"], undefined).catch(() => "")
    ).trim();
    const summary = [subject, stat].filter(Boolean).join("\n").slice(0, MAX_TASK_CHARS);
    return summary || "recent code changes";
  }

  /**
   * Coerce arbitrary model output into a git-safe branch ref. Lowercases,
   * turns whitespace into hyphens, drops characters git refs disallow, and keeps
   * slash-delimited prefixes (so "feature/login-page" survives) while collapsing
   * duplicate or stray `/`, `-`, `.` separators. Returns "" when nothing usable
   * remains, letting the caller fall back to a slug.
   */
  static sanitizeBranchName(raw: string): string {
    const cleaned = raw
      .trim()
      .replace(/^[`'"]+|[`'"]+$/g, "")
      .replace(/^branch\s*[:=]\s*/i, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9/_.-]+/g, "-")
      .replace(/\/{2,}/g, "/")
      .replace(/-{2,}/g, "-")
      .replace(/-*\/-*/g, "/")
      .replace(/^[-/.]+|[-/.]+$/g, "");
    // Reject prose: a real branch name is a few words. More than MAX_BRANCH_WORDS
    // hyphen/slash-delimited words (or excessive length) means the model returned
    // a sentence — return "" so the caller falls back to a clean title slug.
    if (!cleaned) return "";
    const words = cleaned.split(/[/-]/).filter(Boolean).length;
    if (words > MAX_BRANCH_WORDS || cleaned.length > MAX_BRANCH_LEN) return "";
    return cleaned;
  }
}
