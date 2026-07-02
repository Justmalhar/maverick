import { useEffect, useState } from "react";
import {
  Plus,
  SplitSquareHorizontal,
  LayoutDashboard,
  Gauge,
  Globe,
  CheckSquare2,
  Plug,
  Sparkles,
  SquarePen,
  TerminalSquare,
  GitBranch,
  X,
} from "lucide-react";
import { useWorkbench, type SystemTabId } from "@/state/store";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import { usePresets } from "@/hooks/usePresets";
import { useOSPlatform } from "@/hooks/useOSPlatform";
import { formatKeybinding } from "@/shortcuts/format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EditorTab } from "./EditorTab";
import { FileEditorTab } from "./FileEditorTab";
import { SaveLayoutDialog } from "./SaveLayoutDialog";
import { countLeaves } from "@/lib/splitnode";

const SYSTEM_TAB_META: Record<
  SystemTabId,
  // shortcutKeys is the canonical tinykeys binding; rendered per-platform.
  { label: string; icon: typeof Globe; shortcutKeys?: string }
> = {
  dashboard: { label: "Dashboard", icon: LayoutDashboard },
  usage: { label: "Usage", icon: Gauge },
  browser: { label: "Browser", icon: Globe, shortcutKeys: "$mod+Shift+b" },
  kanban: { label: "Tasks", icon: CheckSquare2, shortcutKeys: "$mod+Shift+k" },
  mcps: { label: "MCP Servers", icon: Plug },
  skills: { label: "Skills", icon: Sparkles },
  "skill-editor": { label: "New Skill", icon: SquarePen },
  git: { label: "Git", icon: GitBranch },
};

const DROPDOWN_TAB_IDS: SystemTabId[] = ["dashboard", "usage", "kanban", "mcps", "skills", "git"];

export function EditorTabs() {
  const platform = useOSPlatform();
  const workspaces = useWorkbench((s) => s.workspaces);
  const activeId = useWorkbench((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useWorkbench((s) => s.setActiveWorkspace);
  const removeWorkspace = useWorkbench((s) => s.removeWorkspace);

  const systemTabs = useWorkbench((s) => s.systemTabs);
  const activeSystemTab = useWorkbench((s) => s.activeSystemTab);
  const openSystemTab = useWorkbench((s) => s.openSystemTab);
  const closeSystemTab = useWorkbench((s) => s.closeSystemTab);
  const setActiveSystemTab = useWorkbench((s) => s.setActiveSystemTab);
  const setCommandPaletteOpen = useWorkbench((s) => s.setCommandPaletteOpen);
  const projectPath = useProjectSettingsStore((s) => s.data?.rootPath);
  const { saveCurrentLayout } = usePresets(projectPath);
  const [saveLayoutFor, setSaveLayoutFor] = useState<string | null>(null);

  const handleTabContextMenu = (e: React.MouseEvent, workspaceId: string) => {
    e.preventDefault();
    setSaveLayoutFor(workspaceId);
  };

  // Raw subscription + inline filter avoids a new-array-per-render selector that would
  // trigger a re-render on every unrelated store write.
  const terminalGroups = useWorkbench((s) => s.terminalGroups);
  const activeGroupByWorkspace = useWorkbench((s) => s.activeGroupByWorkspace);
  const setActiveGroup = useWorkbench((s) => s.setActiveGroup);
  const addTerminalGroup = useWorkbench((s) => s.addTerminalGroup);
  const closeTerminalGroup = useWorkbench((s) => s.closeTerminalGroup);

  const fileTabs = useWorkbench((s) => s.fileTabs);
  const activeFileTabId = useWorkbench((s) => s.activeFileTabId);
  const setActiveFileTab = useWorkbench((s) => s.setActiveFileTab);
  const closeFileTab = useWorkbench((s) => s.closeFileTab);
  const pinFileTab = useWorkbench((s) => s.pinFileTab);
  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null);

  const contextWorkspaceId =
    activeId ?? fileTabs.find((t) => t.id === activeFileTabId)?.workspaceId ?? null;
  const ctxGroups = terminalGroups.filter((g) => g.workspaceId === contextWorkspaceId);
  const ctxFileTabs = fileTabs.filter((t) => t.workspaceId === contextWorkspaceId);

  function onOpenPanelTerminal() {
    const state = useWorkbench.getState();
    if (!state.layout.panelVisible) state.togglePanel();
    window.dispatchEvent(new CustomEvent("maverick:panel:tab", { detail: "terminal" }));
  }

  // ⌘W (native menu on macOS, tinykeys elsewhere) closes whichever tab is
  // focused. Exactly one of the active-tab ids is set at a time; close that one
  // with its type-specific handler (file tabs honour the dirty-confirm guard).
  useEffect(() => {
    function onCloseActiveTab() {
      const s = useWorkbench.getState();
      if (s.activeFileTabId) {
        if (!closeFileTab(s.activeFileTabId)) setConfirmCloseId(s.activeFileTabId);
      } else if (s.activeSystemTab) {
        closeSystemTab(s.activeSystemTab);
      } else if (s.activeWorkspaceId) {
        const ws = s.activeWorkspaceId;
        const groupId = s.activeGroupByWorkspace[ws] ?? ws;
        const tree = s.splitTrees[groupId];
        if (tree && countLeaves(tree) > 1) {
          window.dispatchEvent(new CustomEvent("maverick:terminal:closePane"));
        } else if (groupId !== ws) {
          s.closeTerminalGroup(groupId);
        } else {
          removeWorkspace(ws);
        }
      }
    }
    window.addEventListener("maverick:closeActiveTab", onCloseActiveTab);
    return () => window.removeEventListener("maverick:closeActiveTab", onCloseActiveTab);
  }, [closeFileTab, closeSystemTab, removeWorkspace]);

  return (
    <div
      data-testid="editor-tabs"
      className="mv-editor-tabs flex w-full shrink-0 items-stretch bg-tab-inactive"
      style={{ height: "var(--editor-tabs-height)", borderBottom: "1px solid hsl(var(--border))" }}
    >
      <div className="flex h-full flex-1 items-stretch overflow-x-auto">
        {systemTabs.map((id) => {
          const meta = SYSTEM_TAB_META[id];
          const Icon = meta.icon;
          const active = activeSystemTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSystemTab(id)}
              data-testid={`editor-tab-system-${id}`}
              className={cn(
                "group relative flex min-w-[110px] items-center gap-1.5 px-3 text-[12px] transition-colors duration-100",
                active
                  ? "bg-tab-active text-tab-fg-active"
                  : "bg-tab-inactive text-tab-fg hover:bg-foreground/5 hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
              <span className="flex-1 truncate text-left">{meta.label}</span>
              <span
                role="button"
                tabIndex={0}
                aria-label={`Close ${meta.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeSystemTab(id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    closeSystemTab(id);
                  }
                }}
                className="flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 data-[active=true]:opacity-60"
                data-active={active}
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          );
        })}

        {workspaces
          .filter((ws) => ws.id === contextWorkspaceId)
          .map((ws) => (
            <EditorTab
              key={ws.id}
              workspace={ws}
              active={ws.id === activeId}
              onSelect={() => setActiveWorkspace(ws.id)}
              onClose={() => removeWorkspace(ws.id)}
              onContextMenu={(e) => handleTabContextMenu(e, ws.id)}
            />
          ))}

        {ctxGroups.map((g) => {
          const active =
            activeId === contextWorkspaceId && !activeFileTabId && !activeSystemTab &&
            (activeGroupByWorkspace[contextWorkspaceId!] ?? contextWorkspaceId) === g.id;
          const closable = g.id !== g.workspaceId && ctxGroups.length > 1;
          return (
            <button
              key={g.id}
              type="button"
              data-testid={`editor-tab-group-${g.id}`}
              onClick={() => { setActiveWorkspace(g.workspaceId); setActiveGroup(g.workspaceId, g.id); }}
              className={cn(
                "group relative flex min-w-[110px] items-center gap-1.5 px-3 text-[12px] transition-colors duration-100",
                active ? "bg-tab-active text-tab-fg-active" : "bg-tab-inactive text-tab-fg hover:bg-foreground/5 hover:text-foreground"
              )}
            >
              <TerminalSquare className="h-3.5 w-3.5 shrink-0 opacity-70" />
              <span className="flex-1 truncate text-left">{g.title}</span>
              {closable && (
                <span
                  role="button" tabIndex={0} aria-label={`Close ${g.title}`}
                  onClick={(e) => { e.stopPropagation(); closeTerminalGroup(g.id); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); closeTerminalGroup(g.id); } }}
                  className="flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 data-[active=true]:opacity-60"
                  data-active={active}
                >
                  <X className="h-3 w-3" />
                </span>
              )}
            </button>
          );
        })}

        {ctxFileTabs.map((tab) => (
          <FileEditorTab
            key={tab.id}
            tab={tab}
            active={tab.id === activeFileTabId}
            onSelect={() => setActiveFileTab(tab.id)}
            onPin={() => pinFileTab(tab.id)}
            onClose={() => {
              if (!closeFileTab(tab.id)) setConfirmCloseId(tab.id);
            }}
          />
        ))}
      </div>

      <div className="flex items-center gap-px pr-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="New terminal"
              data-testid="editor-tabs-add-terminal"
              disabled={!contextWorkspaceId}
              onClick={() => contextWorkspaceId && addTerminalGroup(contextWorkspaceId)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground disabled:opacity-40"
            >
              <TerminalSquare className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">New terminal in workspace</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Open browser"
              data-testid="editor-tabs-browser"
              onClick={() => openSystemTab("browser")}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground"
            >
              <Globe className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Open browser {formatKeybinding("$mod+Shift+b", platform)}</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Open view"
                  data-testid="editor-tabs-new"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">Open view</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>New</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={onOpenPanelTerminal}
              data-testid="editor-tabs-open-terminal"
            >
              <TerminalSquare className="h-3.5 w-3.5" />
              <span className="flex-1">New Terminal in Panel</span>
              <kbd className="text-[10px] text-muted-foreground">{formatKeybinding("$mod+Shift+t", platform)}</kbd>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Open as tab</DropdownMenuLabel>
            {DROPDOWN_TAB_IDS.map((id) => {
              const meta = SYSTEM_TAB_META[id];
              const Icon = meta.icon;
              return (
                <DropdownMenuItem
                  key={id}
                  onClick={() => openSystemTab(id)}
                  data-testid={`editor-tabs-open-${id}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="flex-1">{meta.label}</span>
                  {meta.shortcutKeys && (
                    <kbd className="text-[10px] text-muted-foreground">{formatKeybinding(meta.shortcutKeys, platform)}</kbd>
                  )}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setCommandPaletteOpen(true)}>
              <span className="flex-1">All commands…</span>
              <kbd className="text-[10px] text-muted-foreground">{formatKeybinding("$mod+Shift+p", platform)}</kbd>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Split terminal horizontally"
              data-testid="editor-tabs-split"
              onClick={() => window.dispatchEvent(new CustomEvent("maverick:terminal:splitH"))}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground"
            >
              <SplitSquareHorizontal className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="flex flex-col gap-0.5">
            <span className="flex items-center justify-between gap-3">
              Split horizontally <kbd className="font-mono text-muted-foreground">{formatKeybinding("$mod+d", platform)}</kbd>
            </span>
            <span className="flex items-center justify-between gap-3">
              Split vertically <kbd className="font-mono text-muted-foreground">{formatKeybinding("$mod+Shift+d", platform)}</kbd>
            </span>
          </TooltipContent>
        </Tooltip>
      </div>

      <SaveLayoutDialog
        open={saveLayoutFor !== null}
        onOpenChange={(open) => !open && setSaveLayoutFor(null)}
        onSave={async (name) => {
          if (saveLayoutFor) await saveCurrentLayout(saveLayoutFor, name);
        }}
      />

      <Dialog open={confirmCloseId !== null} onOpenChange={(o) => !o && setConfirmCloseId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>
              This file has unsaved changes. Close it anyway?
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setConfirmCloseId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmCloseId) closeFileTab(confirmCloseId, { force: true });
                setConfirmCloseId(null);
              }}
            >
              Close without saving
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
