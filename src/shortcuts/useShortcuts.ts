// Wires KEYBINDINGS into tinykeys and dispatches to the Workbench store.
import { useEffect } from "react";
// @ts-expect-error — tinykeys ships types but the package.json exports
// field hides them from TS resolution in bundler mode. The runtime export is fine.
import { tinykeys } from "tinykeys";
import { KEYBINDINGS, type ActionId } from "./registry";
import { useWorkbench } from "@/state/store";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import { runAiReview } from "@/lib/ai-review";

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
      "ai.review": () => {
        const { activeWorkspaceId, workspaces, setEditorMode } = useWorkbench.getState();
        const ws = workspaces.find((w) => w.id === activeWorkspaceId);
        if (!ws) return;
        const reviewPref = useProjectSettingsStore.getState().data?.preferences?.review;
        void runAiReview({
          workspaceId: ws.id,
          worktreePath: ws.worktreePath,
          reviewPref,
          onAgentFocus: () => setEditorMode(ws.id, "agent"),
        }).catch((e) => console.error("AI review failed", e));
      },
      "preview.open": () => {
        const { setAuxiliaryView, toggleAuxiliaryBar, layout } = useWorkbench.getState();
        if (!layout.auxiliaryBarVisible) toggleAuxiliaryBar();
        setAuxiliaryView("preview");
      },
      "preview.toggleMarkdown": () => useWorkbench.getState().togglePreviewRaw(),
      "browser.toggleInspect": () => {
        window.dispatchEvent(new CustomEvent("maverick:browser:toggleInspect"));
      },
      "terminal.splitH": () => {
        window.dispatchEvent(new CustomEvent("maverick:terminal:splitH"));
      },
      "terminal.splitV": () => {
        window.dispatchEvent(new CustomEvent("maverick:terminal:splitV"));
      },
      "terminal.closePane": () => {
        window.dispatchEvent(new CustomEvent("maverick:terminal:closePane"));
      },
      "terminal.clear": () => {
        /* delegated to TerminalView via custom event */
        window.dispatchEvent(new CustomEvent("maverick:terminal:clear"));
      },
      "terminal.focusLeft": () => {
        window.dispatchEvent(new CustomEvent("maverick:terminal:focusDirection", { detail: "left" }));
      },
      "terminal.focusRight": () => {
        window.dispatchEvent(new CustomEvent("maverick:terminal:focusDirection", { detail: "right" }));
      },
      "terminal.focusUp": () => {
        window.dispatchEvent(new CustomEvent("maverick:terminal:focusDirection", { detail: "up" }));
      },
      "terminal.focusDown": () => {
        window.dispatchEvent(new CustomEvent("maverick:terminal:focusDirection", { detail: "down" }));
      },
      "terminal.openBottomTerminal": () => {
        const { layout, togglePanel } = useWorkbench.getState();
        if (!layout.panelVisible) togglePanel();
        window.dispatchEvent(new CustomEvent("maverick:panel:tab", { detail: "terminal" }));
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

    for (let i = 0; i < 9; i++) {
      const idx = i;
      handlers[`workspace.jump.${idx + 1}` as ActionId] = () => {
        const { workspaces, setActiveWorkspace } = useWorkbench.getState();
        const ws = workspaces[idx];
        if (ws) setActiveWorkspace(ws.id);
      };
    }

    const bindings: Record<string, (e: KeyboardEvent) => void> = {};
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
