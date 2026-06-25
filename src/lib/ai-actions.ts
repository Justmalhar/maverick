import { ptyWrite } from "@/lib/tauri";
import type { DiffResult } from "@/lib/ipc";

// Injects each Project Settings preference into the prompt for ITS specific
// action (not just the generic launch preamble), mirroring ai-review's
// buildReviewPrompt: use the preference when non-blank, else a sensible default.
// The composed prompt is sent to the active agent so it performs the action
// honoring the project's convention.

const DEFAULT_CREATE_PR =
  "Open a pull request for the current branch with a clear title and a summary of the changes.";
const DEFAULT_FIX_ERRORS =
  "Run the project's build and tests, then fix any errors you find. Keep changes minimal.";
const DEFAULT_RESOLVE_CONFLICTS =
  "Resolve the merge conflicts in this worktree, preserving the intent of both sides.";

function withPref(def: string, pref?: string): string {
  return pref?.trim() ? pref.trim() : def;
}

/** Create-PR action prompt, shaped by the project's `createPr` preference. */
export function buildCreatePrPrompt(diff: DiffResult, createPrPref?: string): string {
  const instruction = withPref(DEFAULT_CREATE_PR, createPrPref);
  const fileList = diff.files
    .map((f) => `- ${f.status} ${f.path} (+${f.additions} −${f.deletions})`)
    .join("\n");
  return fileList ? `${instruction}\n\nChanged files:\n${fileList}` : instruction;
}

/** Fix-errors action prompt, shaped by the project's `fixErrors` preference. */
export function buildFixErrorsPrompt(fixErrorsPref?: string): string {
  return withPref(DEFAULT_FIX_ERRORS, fixErrorsPref);
}

/** Resolve-conflicts action prompt, shaped by the project's `resolveConflicts` preference. */
export function buildResolveConflictPrompt(files: string[], resolveConflictsPref?: string): string {
  const instruction = withPref(DEFAULT_RESOLVE_CONFLICTS, resolveConflictsPref);
  if (files.length === 0) return instruction;
  const list = files.map((f) => `- ${f}`).join("\n");
  return `${instruction}\n\nConflicted files:\n${list}`;
}

export interface SendAgentPromptOptions {
  agentPtyId: string | undefined;
  prompt: string;
  /** Called before writing so callers can surface the agent view. */
  onAgentFocus?: () => void;
}

/**
 * Write an action prompt to the agent PTY. Returns `{ ran: false }` with no side
 * effects when the prompt is empty or the agent PTY hasn't spawned — `pty_write`
 * keys off the PTY id, so a missing id would otherwise silently no-op.
 */
export async function sendAgentPrompt(opts: SendAgentPromptOptions): Promise<{ ran: boolean }> {
  if (!opts.prompt.trim()) return { ran: false };
  if (!opts.agentPtyId) return { ran: false };
  opts.onAgentFocus?.();
  await ptyWrite(opts.agentPtyId, `${opts.prompt}\n`);
  return { ran: true };
}
