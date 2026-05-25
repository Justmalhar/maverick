// Wires KEYBINDINGS into tinykeys and dispatches to the Workbench store.
import { useEffect } from "react";
// @ts-expect-error — tinykeys ships types but the package.json exports
// field hides them from TS resolution in bundler mode. The runtime export is fine.
import { tinykeys } from "tinykeys";
import { KEYBINDINGS, type ActionId } from "./registry";
import { useWorkbench } from "@/state/store";

export function useShortcuts() {
  const store = useWorkbench();

  useEffect(() => {
    const handlers: Partial<Record<ActionId, () => void>> = {
      "workspace.next": () => {
        const { workspaces, activeWorkspaceId, setActiveWorkspace } = useWorkbench.getState();
        if (!workspaces.length) return;
        const idx = workspaces.findIndex((w) => w.id === activeWorkspaceId);
        const next = workspaces[(idx + 1) % workspaces.length];
        if (next) setActiveWorkspace(next.id);
      },
      "workspace.prev": () => {
        const { workspaces, activeWorkspaceId, setActiveWorkspace } = useWorkbench.getState();
        if (!workspaces.length) return;
        const idx = workspaces.findIndex((w) => w.id === activeWorkspaceId);
        const prev = workspaces[(idx - 1 + workspaces.length) % workspaces.length];
        if (prev) setActiveWorkspace(prev.id);
      },
      "workspace.new": () => useWorkbench.getState().setCommandPaletteOpen(true),
      "workspace.close": () => {
        const { activeWorkspaceId, removeWorkspace } = useWorkbench.getState();
        if (activeWorkspaceId) removeWorkspace(activeWorkspaceId);
      },
      "project.new": () => useWorkbench.getState().setCommandPaletteOpen(true),
      "editor.toggleMode": () => {
        const { activeWorkspaceId, toggleEditorMode } = useWorkbench.getState();
        if (activeWorkspaceId) toggleEditorMode(activeWorkspaceId);
      },
      "editor.focusInput": () => {
        document.querySelector<HTMLElement>("[data-input-bar]")?.focus();
      },
      "editor.retry": () => {
        /* delegated to InputBar */
      },
      "terminal.splitH": () => {
        /* delegated to TerminalView */
      },
      "terminal.splitV": () => {
        /* delegated to TerminalView */
      },
      "terminal.closePane": () => {
        /* delegated to TerminalView */
      },
      "terminal.clear": () => {
        /* delegated to TerminalView via custom event */
        window.dispatchEvent(new CustomEvent("maverick:terminal:clear"));
      },
      "layout.toggleSidebar": () => useWorkbench.getState().togglePrimarySideBar(),
      "layout.toggleAuxBar": () => useWorkbench.getState().toggleAuxiliaryBar(),
      "layout.togglePanel": () => useWorkbench.getState().togglePanel(),
      "view.git": () => useWorkbench.getState().setActivityView("git"),
      "view.kanban": () => useWorkbench.getState().openSystemTab("kanban"),
      "view.browser": () => useWorkbench.getState().openSystemTab("browser"),
      "view.automations": () => useWorkbench.getState().openSystemTab("automations"),
      "global.commandPalette": () => useWorkbench.getState().setCommandPaletteOpen(true),
      "global.quickOpen": () => useWorkbench.getState().setQuickOpenOpen(true),
      "global.presets": () => useWorkbench.getState().setPresetLauncherOpen(true),
      "global.settings": () => useWorkbench.getState().setSettingsOpen(true),
      "global.help": () => useWorkbench.getState().setKeybindingHelpOpen(true),
      "project-settings.open": () => {
        const state = useWorkbench.getState();
        const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
        if (!ws) return;
        state.openProjectSettings({ projectId: ws.projectId });
      },
    };

    // Workspace index jump 1-9
    const indexJumps = Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [
        `$mod+${i + 1}`,
        () => {
          const { workspaces, setActiveWorkspace } = useWorkbench.getState();
          const ws = workspaces[i];
          if (ws) setActiveWorkspace(ws.id);
        },
      ])
    );

    const bindings: Record<string, (e: KeyboardEvent) => void> = { ...indexJumps };
    for (const kb of KEYBINDINGS) {
      if (!kb.keys) continue;
      bindings[kb.keys] = (e: KeyboardEvent) => {
        e.preventDefault();
        handlers[kb.id as ActionId]?.();
      };
    }

    return tinykeys(window, bindings);
  }, [store]);
}
