import { ChevronDown, ChevronUp, Play } from "lucide-react";
import { useWorkbench, selectActiveWorkspace } from "@/state/store";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type BottomPanelTab = "setup" | "run";

interface Props {
  value: BottomPanelTab;
  onChange: (v: BottomPanelTab) => void;
}

const TABS: Array<{ value: BottomPanelTab; label: string }> = [
  { value: "setup", label: "Setup" },
  { value: "run", label: "Run" },
];

function PreviewButton() {
  const ws = useWorkbench(selectActiveWorkspace);
  const previewUrl = useProjectSettingsStore((s) => s.data?.previewUrl ?? "");
  if (!ws || !previewUrl) return null;
  const url = previewUrl
    .replace("${WORKSPACE_NAME}", ws.branch)
    .replace("${WORKSPACE_PATH}", ws.worktreePath)
    .replace("${WORKSPACE_PORT}", "3000");
  return (
    <button
      type="button"
      aria-label="Open preview"
      onClick={() => { void import("@tauri-apps/plugin-shell").then((m) => m.open(url)); }}
      className="flex h-6 items-center gap-1.5 rounded-md bg-sidebar-hover px-2.5 text-[11px] font-medium text-foreground hover:bg-muted"
    >
      Open preview ↗
    </button>
  );
}

export function PanelTabs({ value, onChange }: Props) {
  const togglePanel = useWorkbench((s) => s.togglePanel);
  const panelVisible = useWorkbench((s) => s.layout.panelVisible);

  return (
    <div
      data-testid="panel-tabs"
      className="mv-panel-tabs flex shrink-0 items-center bg-sidebar"
      style={{ height: "var(--panel-tabs-height)", borderTop: "1px solid hsl(var(--border))" }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={togglePanel}
            aria-label={panelVisible ? "Collapse panel" : "Expand panel"}
            data-testid="panel-collapse"
            className="mx-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground"
          >
            {panelVisible ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {panelVisible ? "Collapse panel" : "Expand panel"}
        </TooltipContent>
      </Tooltip>

      <Tabs
        value={value}
        onValueChange={(v) => onChange(v as BottomPanelTab)}
        className="h-full flex-1"
      >
        <TabsList className="h-full">
          {TABS.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              data-testid={`panel-tab-${t.value}`}
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex items-center gap-1 pr-2">
        <PreviewButton />
        <button
          type="button"
          aria-label="Run"
          className="flex h-6 items-center gap-1.5 rounded-md bg-sidebar-hover px-2.5 text-[11px] font-medium text-foreground transition-colors duration-100 hover:bg-muted"
        >
          <Play className="h-3 w-3" />
          Run
        </button>
      </div>
    </div>
  );
}
