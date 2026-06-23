// Wires KEYBINDINGS into tinykeys and dispatches to the Workbench store.
import { useEffect } from "react";
// @ts-expect-error — tinykeys ships types but the package.json exports
// field hides them from TS resolution in bundler mode. The runtime export is fine.
import { tinykeys } from "tinykeys";
import { listen } from "@tauri-apps/api/event";
import { KEYBINDINGS, type ActionId } from "./registry";
import { useWorkbench } from "@/state/store";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import { runAiReview } from "@/lib/ai-review";
import { primaryAgentPtyId } from "@/components/editor/terminal/TerminalLeaf";

// Ask the active editor tab bar to close whatever tab is focused. On macOS this
// is driven by the native Close-Tab menu item (⌘W); on Windows/Linux by the
// tinykeys binding below. EditorTabs owns the per-tab-type close logic.
function requestCloseActiveTab(): void {
  window.dispatchEvent(new CustomEvent("maverick:closeActiveTab"));
}

export function useShortcuts() {
  const store = useWorkbench();

  // macOS routes ⌘W through the native menu (it consumes the key before the
  // webview sees it), which emits `menu://close-tab` from Rust.
  useEffect(() => {
    const unlisten = listen("menu://close-tab", () => requestCloseActiveTab());
    return () => {
      void unlisten.then((un) => un()).catch(() => {});
    };
  }, []);

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
      "workspace.close": () => requestCloseActiveTab(),
      "project.new": () => useWorkbench.getState().setCommandPaletteOpen(true),
      "editor.focusInput": () => {
        document.querySelector<HTMLElement>("[data-input-bar]")?.focus();
      },
      "ai.review": () => {
        const { activeWorkspaceId, workspaces, setActiveWorkspace } = useWorkbench.getState();
        const ws = workspaces.find((w) => w.id === activeWorkspaceId);
        if (!ws) return;
        const reviewPref = useProjectSettingsStore.getState().data?.preferences?.review;
        void runAiReview({
          agentPtyId: primaryAgentPtyId(ws.id),
          worktreePath: ws.worktreePath,
          reviewPref,
          onAgentFocus: () => setActiveWorkspace(ws.id),
        }).catch((e) => console.error("AI review failed", e));
      },
      // preview.open and preview.toggleMarkdown have been removed — the
      // AuxiliaryBar preview tab is gone; files now open as editor file tabs.
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
        const state = useWorkbench.getState();
        if (!state.layout.panelVisible) state.togglePanel();
        window.dispatchEvent(new CustomEvent("maverick:panel:tab", { detail: "terminal" }));
      },
      "layout.toggleSidebar": () => useWorkbench.getState().togglePrimarySideBar(),
      "layout.toggleAuxBar": () => useWorkbench.getState().toggleAuxiliaryBar(),
      "layout.togglePanel": () => useWorkbench.getState().togglePanel(),
      "view.git": () => useWorkbench.getState().openSourceControl(),
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
