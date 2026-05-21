// ⌘⇧Space fuzzy launcher — shadcn Command overlay.
import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { presetList, presetLaunch } from "@/lib/tauri";
import { useWorkbench } from "@/state/store";
import type { WorkspacePreset } from "@/lib/ipc";
import PresetThumbnail from "./PresetThumbnail";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function PresetPicker({ open, onOpenChange }: Props) {
  const [presets, setPresets] = useState<WorkspacePreset[]>([]);
  const [query, setQuery] = useState("");
  const projectId = useWorkbench((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    return ws?.projectId ?? s.projects[0]?.id ?? "";
  });
  const projectPath = useWorkbench((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    return s.projects.find((p) => p.id === ws?.projectId)?.path;
  });
  const addWorkspace = useWorkbench((s) => s.addWorkspace);
  const setActiveWorkspace = useWorkbench((s) => s.setActiveWorkspace);

  useEffect(() => {
    if (!open) return;
    presetList(projectPath).then(setPresets).catch(() => setPresets([]));
  }, [open, projectPath]);

  const filtered = useMemo(() => {
    if (!query) return presets;
    const q = query.toLowerCase();
    return presets.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q)
    );
  }, [presets, query]);

  const launch = async (preset: WorkspacePreset) => {
    try {
      const result = await presetLaunch(preset, projectId, preset.baseBranch);
      addWorkspace({
        id: result.workspaceId,
        projectId,
        branch: preset.baseBranch ?? "main",
        agentBackend: "preset",
        worktreePath: "",
        status: "active",
        sessionId: result.workspaceId,
        title: preset.name,
      });
      setActiveWorkspace(result.workspaceId);
      onOpenChange(false);
    } catch (e) {
      console.error("Preset launch failed", e);
    }
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search presets…"
        value={query}
        onValueChange={setQuery}
        data-testid="preset-picker-input"
      />
      <CommandList data-testid="preset-picker-list">
        <CommandEmpty>No presets found.</CommandEmpty>
        <CommandGroup heading="Presets">
          {filtered.map((preset) => (
            <CommandItem
              key={preset.name}
              value={preset.name}
              onSelect={() => launch(preset)}
              data-testid="preset-picker-item"
              className="gap-3"
            >
              <PresetThumbnail preset={preset} />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-1.5 text-foreground">
                  <Sparkles className="h-3 w-3 text-primary" />
                  <span className="truncate">{preset.name}</span>
                </div>
                {preset.description && (
                  <span className="truncate text-[10px] text-muted-foreground">
                    {preset.description}
                  </span>
                )}
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
