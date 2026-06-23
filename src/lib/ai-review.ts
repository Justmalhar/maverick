import { diffGet, ptyWrite } from "@/lib/tauri";
import type { DiffResult } from "@/lib/ipc";
import type { ReviewComment } from "@/lib/stores/review-comments";

const REVIEW_COMMENTS_HEADER =
  "Please address these review comments on the current diff. Each line references a " +
  "file and line number:";

/**
 * Compose a structured prompt from inline diff comments — one
 * `Re: <file>:<line> — <body>` line per comment, in insertion order. Returns an
 * empty string when there are no comments so callers can skip sending.
 */
export function buildReviewCommentsPrompt(comments: ReviewComment[]): string {
  if (comments.length === 0) return "";
  const lines = comments.map((c) => `Re: ${c.file}:${c.line} — ${c.body}`);
  return `${REVIEW_COMMENTS_HEADER}\n\n${lines.join("\n")}`;
}

const DEFAULT_REVIEW_INSTRUCTION =
  "Review the staged and unstaged changes in this worktree. Flag correctness bugs, " +
  "security issues, and missing tests. Be concise and reference file paths.";

/** Compose a code-review prompt from a diff and the project's `review` AI preference. */
export function buildReviewPrompt(diff: DiffResult, reviewPref?: string): string {
  const instruction = reviewPref?.trim() ? reviewPref.trim() : DEFAULT_REVIEW_INSTRUCTION;
  const fileList = diff.files
    .map((f) => `- ${f.status} ${f.path} (+${f.additions} −${f.deletions})`)
    .join("\n");
  return `${instruction}\n\nChanged files:\n${fileList}`;
}

export interface RunAiReviewOptions {
  /** The agent leaf's live PTY id (resolved by the caller). */
  agentPtyId: string | undefined;
  worktreePath: string;
  reviewPref?: string;
  /** Called before writing the prompt so callers can surface the agent view. */
  onAgentFocus?: () => void;
}

/**
 * Fetch the worktree diff and send a review prompt to the agent PTY.
 * Returns `{ ran: false }` when the tree is clean OR the agent PTY hasn't spawned
 * yet — `pty_write` keys off the PTY id, not the workspace id, so a missing id
 * would otherwise silently no-op.
 */
export async function runAiReview(opts: RunAiReviewOptions): Promise<{ ran: boolean }> {
  const diff = await diffGet(opts.worktreePath);
  if (diff.files.length === 0) return { ran: false };
  if (!opts.agentPtyId) return { ran: false };
  const prompt = buildReviewPrompt(diff, opts.reviewPref);
  opts.onAgentFocus?.();
  await ptyWrite(opts.agentPtyId, `${prompt}\n`);
  return { ran: true };
}
