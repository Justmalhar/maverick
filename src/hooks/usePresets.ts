import { useCallback, useEffect, useState } from "react";
import { presetList, presetLaunch, presetSaveCurrent } from "@/lib/tauri";
import type { WorkspacePreset } from "@/lib/ipc";

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
      const saved = await presetSaveCurrent(workspaceId, name);
      setPresets((prev) => [...prev, saved]);
      return saved;
    },
    []
  );

  return { presets, launch, saveCurrentLayout };
}
