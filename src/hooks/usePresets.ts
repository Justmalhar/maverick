import { useCallback, useEffect, useState } from "react";
import { presetList, presetLaunch, presetSaveCurrent } from "@/lib/tauri";
import { useWorkbench } from "@/state/store";
import type { EditorMode, PresetNode, SplitNode, WorkspacePreset } from "@/lib/ipc";

// Worktree-relative cwd placeholder the sidecar expands per launch.
const WORKSPACE_ROOT = "{{workspace_root}}";

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
  const mode: EditorMode = state.editorModes[workspaceId] ?? "agent";
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
