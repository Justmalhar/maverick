import { PanelBottom, PanelLeft, PanelRight, Search, Settings } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useWorkbench } from "@/state/store";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useOSPlatform } from "@/hooks/useOSPlatform";
import { WindowControls } from "./WindowControls";

async function startDrag() {
  try {
    await getCurrentWindow().startDragging();
  } catch {
    /* running outside Tauri (tests / browser dev) */
  }
}

// Warp-style single-row chrome: traffic lights / window controls sit in the
// OS title bar (Overlay mode), our search pill is centered inside that same
// strip. No separate label row, no "Maverick" text.
// Drag is handled via Tauri's startDragging() — more reliable than CSS
// -webkit-app-region in WKWebView.
export function TitleBar() {
  const setQuickOpenOpen = useWorkbench((s) => s.setQuickOpenOpen);
  const setSettingsOpen = useWorkbench((s) => s.setSettingsOpen);
  const togglePrimarySideBar = useWorkbench((s) => s.togglePrimarySideBar);
  const toggleAuxiliaryBar = useWorkbench((s) => s.toggleAuxiliaryBar);
  const togglePanel = useWorkbench((s) => s.togglePanel);
  const primarySideBarVisible = useWorkbench((s) => s.layout.primarySideBarVisible);
  const auxiliaryBarVisible = useWorkbench((s) => s.layout.auxiliaryBarVisible);
  const panelVisible = useWorkbench((s) => s.layout.panelVisible);
  const platform = useOSPlatform();
  const isMac = platform === "macos";

  function handleMouseDown(e: React.MouseEvent<HTMLElement>) {
    if (e.button !== 0) return;
    if ((e.target as Element).closest("button, a, input, select, textarea")) return;
    startDrag();
  }

  return (
    <header
      data-testid="titlebar"
      data-platform={platform}
      data-tauri-drag-region
      onMouseDown={handleMouseDown}
      className="mv-titlebar drag select-none relative z-titlebar grid w-full shrink-0 grid-cols-[1fr_auto_1fr] items-center bg-titlebar"
      style={{ height: "38px" }}
    >
      {/* Left gutter — traffic lights space + PrimarySideBar toggle */}
      <div
        data-tauri-drag-region
        className="drag flex h-full items-center gap-1 pl-2"
        style={{ paddingLeft: isMac ? "76px" : "8px" }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={togglePrimarySideBar}
              data-testid="titlebar-toggle-primarysidebar"
              aria-pressed={primarySideBarVisible}
              className="no-drag flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground"
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {primarySideBarVisible ? "Hide" : "Show"} Primary Side Bar
          </TooltipContent>
        </Tooltip>
      </div>

      <div data-tauri-drag-region className="drag flex h-full items-center justify-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setQuickOpenOpen(true)}
              data-testid="titlebar-quickopen"
              className="no-drag flex h-7 w-[460px] max-w-[60vw] items-center gap-2 rounded-md border border-border-glass bg-activitybar/70 px-3 text-xs text-muted-foreground backdrop-blur-md transition-colors duration-100 hover:border-border-glass-strong hover:bg-sidebar-hover/80 hover:text-foreground"
            >
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 text-left">Search files, commands, projects…</span>
              <kbd className="rounded-md bg-background/60 px-1.5 py-px text-[10px] tracking-wide text-muted-foreground">
                ⌘P
              </kbd>
            </button>
          </TooltipTrigger>
          <TooltipContent>Quick open ⌘P</TooltipContent>
        </Tooltip>
      </div>

      <div data-tauri-drag-region className="drag flex h-full items-center justify-end gap-1 pr-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={togglePanel}
              data-testid="titlebar-toggle-panel"
              aria-pressed={panelVisible}
              className="no-drag flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground"
            >
              <PanelBottom className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {panelVisible ? "Hide" : "Show"} Panel
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggleAuxiliaryBar}
              data-testid="titlebar-toggle-auxiliarybar"
              aria-pressed={auxiliaryBarVisible}
              className="no-drag flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground"
            >
              <PanelRight className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {auxiliaryBarVisible ? "Hide" : "Show"} Auxiliary Bar
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              data-testid="titlebar-settings"
              className="no-drag flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Settings ⌘,</TooltipContent>
        </Tooltip>
        {!isMac && <WindowControls className="ml-1" />}
      </div>
    </header>
  );
}
