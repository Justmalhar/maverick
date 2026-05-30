import { diffGet, ptyWrite } from "@/lib/tauri";
import type { DiffResult } from "@/lib/ipc";

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
  workspaceId: string;
  worktreePath: string;
  reviewPref?: string;
  /** Called before writing the prompt so callers can surface the agent view. */
  onAgentFocus?: () => void;
}

/**
 * Fetch the worktree diff and send a review prompt to the workspace's agent PTY.
 * Returns `{ ran: false }` when the working tree is clean (nothing to review).
 */
export async function runAiReview(opts: RunAiReviewOptions): Promise<{ ran: boolean }> {
  const diff = await diffGet(opts.worktreePath);
  if (diff.files.length === 0) return { ran: false };
  const prompt = buildReviewPrompt(diff, opts.reviewPref);
  opts.onAgentFocus?.();
  await ptyWrite(opts.workspaceId, `${prompt}\n`);
  return { ran: true };
}
