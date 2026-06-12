import { useMemo } from "react";
import {
  FolderPlus,
  GitBranch,
  KanbanSquare,
  Globe,
  Zap,
  Plug,
  Settings,
  SlidersHorizontal,
  PanelLeft,
  PanelRight,
  PanelBottom,
  Sparkles,
  TerminalSquare,
  FileSearch,
  Eye,
} from "lucide-react";
import { useWorkbench } from "@/state/store";
import { KEYBINDINGS } from "@/shortcuts/registry";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";

interface CommandEntry {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
  shortcutId?: string;
}

export function CommandPalette() {
  const open = useWorkbench((s) => s.commandPaletteOpen);
  const setOpen = useWorkbench((s) => s.setCommandPaletteOpen);
  const showPrimarySideBar = useWorkbench((s) => s.showPrimarySideBar);
  const openSourceControl = useWorkbench((s) => s.openSourceControl);
  const openSystemTab = useWorkbench((s) => s.openSystemTab);
  const togglePrimarySideBar = useWorkbench((s) => s.togglePrimarySideBar);
  const toggleAuxiliaryBar = useWorkbench((s) => s.toggleAuxiliaryBar);
  const togglePanel = useWorkbench((s) => s.togglePanel);
  const setSettingsOpen = useWorkbench((s) => s.setSettingsOpen);
  const setPresetLauncherOpen = useWorkbench((s) => s.setPresetLauncherOpen);
  const setQuickOpenOpen = useWorkbench((s) => s.setQuickOpenOpen);
  const setAuxiliaryView = useWorkbench((s) => s.setAuxiliaryView);
  const activeId = useWorkbench((s) => s.activeWorkspaceId);
  const toggleEditorMode = useWorkbench((s) => s.toggleEditorMode);
  const openProjectSettings = useWorkbench((s) => s.openProjectSettings);

  const commands: CommandEntry[] = useMemo(
    () => [
      {
        id: "project.new",
        label: "Projects: Add project…",
        icon: FolderPlus,
        run: () => {
          showPrimarySideBar();
          setOpen(false);
        },
        shortcutId: "project.new",
      },
      {
        id: "global.quickOpen",
        label: "Go to File…",
        icon: FileSearch,
        run: () => {
          setQuickOpenOpen(true);
          setOpen(false);
        },
        shortcutId: "global.quickOpen",
      },
      {
        id: "preview.open",
        label: "View: Open Preview",
        icon: Eye,
        run: () => {
          setAuxiliaryView("preview");
          setOpen(false);
        },
        shortcutId: "preview.open",
      },
      {
        id: "view.git",
        label: "View: Show Source Control",
        icon: GitBranch,
        run: () => {
          openSourceControl();
          setOpen(false);
        },
        shortcutId: "view.git",
      },
      {
        id: "view.kanban",
        label: "View: Show Kanban",
        icon: KanbanSquare,
        run: () => {
          openSystemTab("kanban");
          setOpen(false);
        },
        shortcutId: "view.kanban",
      },
      {
        id: "view.browser",
        label: "View: Show Browser",
        icon: Globe,
        run: () => {
          openSystemTab("browser");
          setOpen(false);
        },
        shortcutId: "view.browser",
      },
      {
        id: "view.automations",
        label: "View: Show Automations",
        icon: Zap,
        run: () => {
          openSystemTab("automations");
          setOpen(false);
        },
        shortcutId: "view.automations",
      },
      {
        id: "view.mcps",
        label: "View: Show MCP Servers",
        icon: Plug,
        run: () => {
          openSystemTab("mcps");
          setOpen(false);
        },
      },
      {
        id: "global.settings",
        label: "Preferences: Open Settings",
        icon: Settings,
        run: () => {
          setSettingsOpen(true);
          setOpen(false);
        },
        shortcutId: "global.settings",
      },
      {
        id: "project-settings.open",
        label: "Project Settings: Open for active project",
        icon: SlidersHorizontal,
        run: () => {
          const state = useWorkbench.getState();
          const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
          if (!ws) return;
          openProjectSettings({ projectId: ws.projectId });
          setOpen(false);
        },
        shortcutId: "project-settings.open",
      },
      {
        id: "global.presets",
        label: "Maverick: Open preset launcher",
        icon: Sparkles,
        run: () => {
          setPresetLauncherOpen(true);
          setOpen(false);
        },
        shortcutId: "global.presets",
      },
      {
        id: "layout.toggleSidebar",
        label: "View: Toggle Primary Side Bar",
        icon: PanelLeft,
        run: () => {
          togglePrimarySideBar();
          setOpen(false);
        },
        shortcutId: "layout.toggleSidebar",
      },
      {
        id: "layout.toggleAuxBar",
        label: "View: Toggle Auxiliary Bar",
        icon: PanelRight,
        run: () => {
          toggleAuxiliaryBar();
          setOpen(false);
        },
        shortcutId: "layout.toggleAuxBar",
      },
      {
        id: "layout.togglePanel",
        label: "View: Toggle Panel",
        icon: PanelBottom,
        run: () => {
          togglePanel();
          setOpen(false);
        },
        shortcutId: "layout.togglePanel",
      },
      {
        id: "editor.toggleMode",
        label: "Workspace: Toggle Agent ↔ Terminal",
        icon: TerminalSquare,
        run: () => {
          if (activeId) toggleEditorMode(activeId);
          setOpen(false);
        },
        shortcutId: "editor.toggleMode",
      },
    ],
    [
      activeId,
      openProjectSettings,
      showPrimarySideBar,
      openSourceControl,
      openSystemTab,
      setAuxiliaryView,
      setOpen,
      setPresetLauncherOpen,
      setQuickOpenOpen,
      setSettingsOpen,
      toggleAuxiliaryBar,
      toggleEditorMode,
      togglePanel,
      togglePrimarySideBar,
    ]
  );

  const shortcutMap = useMemo(
    () => Object.fromEntries(KEYBINDINGS.map((k) => [k.id, k.display ?? k.keys])),
    []
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="left-[50%] top-[72px] w-[600px] max-w-[90vw] translate-x-[-50%] translate-y-0 gap-0 overflow-hidden border border-border-strong bg-popover p-0 shadow-lg"
      >
        <Command className="bg-popover">
          <CommandInput
            placeholder="Type a command name…"
            data-testid="commandpalette-input"
          />
          <CommandList>
            <CommandEmpty>No commands</CommandEmpty>
            <CommandGroup>
              {commands.map((c) => {
                const Icon = c.icon;
                return (
                  <CommandItem
                    key={c.id}
                    value={c.label}
                    onSelect={() => c.run()}
                    data-testid={`commandpalette-item-${c.id}`}
                  >
                    <Icon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                    {c.label}
                    {c.shortcutId && shortcutMap[c.shortcutId] && (
                      <CommandShortcut>
                        {shortcutMap[c.shortcutId]}
                      </CommandShortcut>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
