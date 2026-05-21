import {
  Plus,
  SplitSquareHorizontal,
  LayoutDashboard,
  Globe,
  CheckSquare2,
  Zap,
  Plug,
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

  return (
    <div
      data-testid="editor-tabs"
      className="mv-editor-tabs flex w-full shrink-0 items-stretch bg-tab-inactive"
      style={{ height: "var(--editor-tabs-height)" }}
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
                "group flex h-full min-w-[120px] items-center gap-1.5 px-3 text-[12px] transition-colors duration-100",
                active
                  ? "bg-tab-active text-tab-fg-active"
                  : "bg-tab-inactive text-tab-fg hover:text-foreground"
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
      </div>

      <div className="flex items-center gap-px pr-2">
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
            <DropdownMenuLabel>Open as tab</DropdownMenuLabel>
            {(Object.keys(SYSTEM_TAB_META) as SystemTabId[]).map((id) => {
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
