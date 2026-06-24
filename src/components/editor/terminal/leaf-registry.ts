import { ptyKill } from "@/lib/tauri";

// Live shell-PTY registry for terminal leaves, kept out of TerminalLeaf.tsx so
// that module exports only its component (React Fast Refresh full-reloads any
// component file that also exports non-components — and a reload here tears down
// every live PTY mid-session).
//
// Keyed by split-leaf id so a pane's shell survives splits / remounts / tab
// switches. The SplitNode.ptyId field is no longer the source of truth for the
// live PTY — this cache is. Entries are evicted by killLeaf() on pane close.
export const leafPtyCache = new Map<string, string>();

/** Kill and evict a terminal-mode leaf's shell PTY. Called when a pane closes. */
export function killLeaf(leafId: string): void {
  const ptyId = leafPtyCache.get(leafId);
  if (!ptyId) return;
  leafPtyCache.delete(leafId);
  void ptyKill(ptyId).catch(() => {});
}

/** Kill every leaf shell PTY belonging to a workspace (ids are `${workspaceId}-…`). */
export function killWorkspaceLeaves(workspaceId: string): void {
  const prefix = `${workspaceId}-`;
  for (const leafId of [...leafPtyCache.keys()]) {
    if (leafId.startsWith(prefix)) killLeaf(leafId);
  }
}

/** The live shell PTY id for a leaf, or undefined if it has not spawned yet. */
export function getLeafPtyId(leafId: string): string | undefined {
  return leafPtyCache.get(leafId);
}

/**
 * The live PTY id of a workspace's PRIMARY leaf (`${workspaceId}-1`) — the leaf
 * that runs the agent CLI. Undefined until it spawns. This is what agent-facing
 * writes (review prompts, comment batches) must target; `pty_write` keys off the
 * PTY id, never the workspace id.
 */
export function primaryAgentPtyId(workspaceId: string): string | undefined {
  return leafPtyCache.get(`${workspaceId}-1`);
}

export const __testing__ = { leafPtyCache };
