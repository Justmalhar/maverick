import { diffGet } from "@/lib/tauri";
import { dispatchAgentPrompt, type AgentTarget } from "@/lib/ai-actions";
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

export interface SendReviewCommentsOptions {
  target: AgentTarget;
  comments: ReviewComment[];
  /** Called before dispatching so callers can surface the agent view. */
  onAgentFocus?: () => void;
}

/**
 * Send a batched `Re:`-prompt of inline review comments to the workspace's agent
 * terminal. Returns `{ ran: false }` when there are no comments or the agent is
 * unreachable.
 */
export async function sendReviewComments(
  opts: SendReviewCommentsOptions
): Promise<{ ran: boolean }> {
  if (opts.comments.length === 0) return { ran: false };
  return dispatchAgentPrompt(opts.target, buildReviewCommentsPrompt(opts.comments), opts.onAgentFocus);
}

export interface RunAiReviewOptions {
  target: AgentTarget;
  worktreePath: string;
  reviewPref?: string;
  /** Called before dispatching the prompt so callers can surface the agent view. */
  onAgentFocus?: () => void;
}

/**
 * Fetch the worktree diff and send a review prompt to the workspace's agent
 * terminal. Returns `{ ran: false }` when the tree is clean or the agent is
 * unreachable.
 */
export async function runAiReview(opts: RunAiReviewOptions): Promise<{ ran: boolean }> {
  const diff = await diffGet(opts.worktreePath);
  if (diff.files.length === 0) return { ran: false };
  return dispatchAgentPrompt(opts.target, buildReviewPrompt(diff, opts.reviewPref), opts.onAgentFocus);
}
