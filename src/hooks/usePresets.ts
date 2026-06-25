import { useCallback, useEffect, useState } from "react";
import { presetList, presetLaunch, presetSaveCurrent } from "@/lib/tauri";
import { resolveLaunch } from "@/lib/launch";
import { useWorkbench } from "@/state/store";
import type { EditorMode, PresetNode, SplitNode, WorkspacePreset } from "@/lib/ipc";

// Worktree-relative cwd placeholder the sidecar expands per launch.
const WORKSPACE_ROOT = "{{workspace_root}}";

/**
 * Convert a preset layout (returned by preset.launch, with cwd already resolved
 * to the worktree) into a live SplitNode tree the SplitGrid renders. Each
 * terminal node becomes a leaf that spawns its agent command via Rust ConPTY
 * (the single PTY authority); leaf ids are `${workspaceId}-N` (1-based, primary
 * first) so killWorkspaceLeaves / primaryAgentPtyId keep matching. Browser nodes
 * have no place in the (terminal-only) SplitGrid yet, so a split with a browser
 * child collapses to its terminal sibling.
 */
export function presetNodeToSplitTree(layout: PresetNode, workspaceId: string): SplitNode {
  let n = 0;
  const conv = (node: PresetNode): SplitNode | null => {
    if (node.type === "terminal") {
      const isShell = !node.agent || node.agent === "shell";
      const resolved = isShell ? undefined : resolveLaunch(node.agent);
      return {
        type: "terminal",
        id: `${workspaceId}-${++n}`,
        backend: node.agent || "shell",
        ptyId: "",
        ...(resolved ? { command: resolved.command, args: resolved.args } : {}),
        ...(node.cwd && node.cwd !== WORKSPACE_ROOT ? { cwd: node.cwd } : {}),
        ...(node.startup ? { startup: node.startup } : {}),
      };
    }
    if (node.type === "browser") return null;
    const a = "top" in node ? node.top : node.left;
    const b = "top" in node ? node.bottom : node.right;
    const left = conv(a);
    const right = conv(b);
    if (left && right) {
      return { type: "split", direction: node.direction, ratio: node.ratio, left, right };
    }
    return left ?? right; // collapse a split whose other side was a browser node
  };
  return conv(layout) ?? { type: "terminal", id: `${workspaceId}-1`, backend: "shell", ptyId: "" };
}

/** Convert a live SplitNode tree into a serialisable PresetNode layout. */
export function splitTreeToPresetNode(node: SplitNode, mode: EditorMode): PresetNode {
  if (node.type === "terminal") {
    return { type: "terminal", agent: node.backend, cwd: WORKSPACE_ROOT, mode };
  }
  // SplitNode always nests as left/right; a vertical split maps to top/bottom.
  if (node.direction === "v") {
    return {
      type: "split",
      direction: "v",
      ratio: node.ratio,
      top: splitTreeToPresetNode(node.left, mode),
      bottom: splitTreeToPresetNode(node.right, mode),
    };
  }
  return {
    type: "split",
    direction: "h",
    ratio: node.ratio,
    left: splitTreeToPresetNode(node.left, mode),
    right: splitTreeToPresetNode(node.right, mode),
  };
}

/**
 * Build the PresetNode layout for a workspace from its current editor state:
 * the split tree when present, otherwise a single terminal running the
 * workspace's agent backend.
 */
export function buildWorkspaceLayout(workspaceId: string): PresetNode {
  const state = useWorkbench.getState();
  const mode: EditorMode = "terminal";
  const tree = state.splitTrees[workspaceId];
  if (tree) return splitTreeToPresetNode(tree, mode);
  const ws = state.workspaces.find((w) => w.id === workspaceId);
  return { type: "terminal", agent: ws?.agentBackend ?? "shell", cwd: WORKSPACE_ROOT, mode };
}

export function usePresets(projectPath?: string) {
  const [presets, setPresets] = useState<WorkspacePreset[]>([]);

  useEffect(() => {
    let cancelled = false;
    presetList(projectPath)
      .then((list) => {
        if (!cancelled) setPresets(list);
      })
      .catch(() => {
        // sidecar not yet ready — keep empty list
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  const launch = useCallback(
    async (preset: WorkspacePreset, projectPath: string, branch?: string) =>
      presetLaunch(preset, projectPath, branch),
    []
  );

  const saveCurrentLayout = useCallback(
    async (workspaceId: string, name: string) => {
      const layout = buildWorkspaceLayout(workspaceId);
      const saved = await presetSaveCurrent(workspaceId, name, layout);
      setPresets((prev) => [saved, ...prev]);
      return saved;
    },
    []
  );

  return { presets, launch, saveCurrentLayout };
}
