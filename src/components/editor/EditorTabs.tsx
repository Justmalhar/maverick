import {
  Plus,
  SplitSquareHorizontal,
  LayoutDashboard,
  Globe,
  CheckSquare2,
  Zap,
  Plug,
  TerminalSquare,
  X,
} from "lucide-react";
import { useWorkbench, type SystemTabId } from "@/state/store";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { EditorTab } from "./EditorTab";
import { useTerminalTab } from "@/hooks/useTerminalTab";
import { defaultTerminalCwd } from "@/lib/default-cwd";

const SYSTEM_TAB_META: Record<
  SystemTabId,
  { label: string; icon: typeof Globe; shortcut?: string }
> = {
  dashboard: { label: "Dashboard", icon: LayoutDashboard },
  browser: { label: "Browser", icon: Globe, shortcut: "⌘⇧B" },
  kanban: { label: "Tasks", icon: CheckSquare2, shortcut: "⌘⇧K" },
  automations: { label: "Automations", icon: Zap, shortcut: "⌘⇧A" },
  mcps: { label: "MCP Servers", icon: Plug },
};

const DROPDOWN_TAB_IDS: SystemTabId[] = ["dashboard", "kanban", "automations", "mcps"];

export function EditorTabs() {
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

  const terminalTabs = useWorkbench((s) => s.terminalTabs);
  const activeTerminalTabId = useWorkbench((s) => s.activeTerminalTabId);
  const setActiveTerminalTab = useWorkbench((s) => s.setActiveTerminalTab);
  const { open: openTerminal, close: closeTerminal } = useTerminalTab();

  async function onNewTerminal() {
    const cwd = await defaultTerminalCwd();
    await openTerminal(cwd);
  }

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

        {workspaces.map((ws) => (
          <EditorTab
            key={ws.id}
            workspace={ws}
            active={ws.id === activeId}
            onSelect={() => setActiveWorkspace(ws.id)}
            onClose={() => removeWorkspace(ws.id)}
          />
        ))}

        {terminalTabs.map((tab) => {
          const active = activeTerminalTabId === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTerminalTab(tab.id)}
              data-testid={`editor-tab-terminal-${tab.id}`}
              className={cn(
                "group relative flex min-w-[110px] items-center gap-1.5 px-3 text-[12px] transition-colors duration-100",
                active
                  ? "bg-tab-active text-tab-fg-active"
                  : "bg-tab-inactive text-tab-fg hover:bg-foreground/5 hover:text-foreground"
              )}
            >
              <TerminalSquare className="h-3.5 w-3.5 shrink-0 opacity-70" />
              <span className="flex-1 truncate text-left">{tab.title}</span>
              <span
                role="button"
                tabIndex={0}
                aria-label={`Close ${tab.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void closeTerminal(tab.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    void closeTerminal(tab.id);
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
      </div>

      <div className="flex items-center gap-px pr-2">
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
          <TooltipContent side="bottom">Open browser ⌘⇧B</TooltipContent>
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
              onClick={onNewTerminal}
              data-testid="editor-tabs-open-terminal"
            >
              <TerminalSquare className="h-3.5 w-3.5" />
              <span className="flex-1">Terminal</span>
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
                  {meta.shortcut && (
                    <kbd className="text-[10px] text-muted-foreground">{meta.shortcut}</kbd>
                  )}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setCommandPaletteOpen(true)}>
              <span className="flex-1">All commands…</span>
              <kbd className="text-[10px] text-muted-foreground">⌘⇧P</kbd>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Split editor"
              data-testid="editor-tabs-split"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground"
            >
              <SplitSquareHorizontal className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Split editor</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
