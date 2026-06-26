import { agentRun, ptyWrite } from "@/lib/tauri";
import { primaryAgentPtyId } from "@/components/editor/terminal/leaf-registry";
import { supportsHeadlessLaunch } from "@/lib/agent-launch";
import { useAgentStatusStore } from "@/hooks/useAgentStatus";
import type { DiffResult } from "@/lib/ipc";

/** Identifies a workspace's agent so an action can reach it in either launch mode. */
export interface AgentTarget {
  workspaceId: string;
  backend: string;
  cwd: string;
}

/**
 * Send a composed prompt to a workspace's agent, working in BOTH launch modes:
 * write to the live terminal PTY when one exists, else — for a headless workspace
 * (no PTY) — dispatch a background agentRun. Returns {ran:false} only when the
 * prompt is empty or neither path is available.
 */
export async function dispatchAgentPrompt(
  target: AgentTarget,
  prompt: string,
  onAgentFocus?: () => void
): Promise<{ ran: boolean }> {
  if (!prompt.trim()) return { ran: false };
  const ptyId = primaryAgentPtyId(target.workspaceId);
  if (ptyId) {
    onAgentFocus?.();
    await ptyWrite(ptyId, `${prompt}\n`);
    return { ran: true };
  }
  if (supportsHeadlessLaunch(target.backend)) {
    useAgentStatusStore.getState().setStatus(target.workspaceId, "working");
    onAgentFocus?.();
    await agentRun({
      workspaceId: target.workspaceId,
      backend: target.backend,
      prompt,
      cwd: target.cwd,
    });
    return { ran: true };
  }
  return { ran: false };
}

/** Whether an AI action can reach this workspace's agent (live PTY or headless). */
export function canDispatchAgentAction(target: AgentTarget): boolean {
  return primaryAgentPtyId(target.workspaceId) !== undefined || supportsHeadlessLaunch(target.backend);
}

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
  target: AgentTarget;
  prompt: string;
  /** Called before dispatching so callers can surface the agent view. */
  onAgentFocus?: () => void;
}

/** Send an action prompt to a workspace's agent (terminal or headless). */
export async function sendAgentPrompt(opts: SendAgentPromptOptions): Promise<{ ran: boolean }> {
  return dispatchAgentPrompt(opts.target, opts.prompt, opts.onAgentFocus);
}
