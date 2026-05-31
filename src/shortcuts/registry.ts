// Global keyboard registry — single source of truth for all keybindings.
// Components read action labels from here; the handler hook binds them.

export interface KeybindingDef {
  id: string;
  label: string;
  category: "Workspace" | "Editor" | "Terminal" | "Panel" | "Git" | "Global";
  // Empty string means the action is palette-only with no global shortcut bound.
  keys: string;
  // Display form (rendered as ⌘⇧K etc.). Falls back to keys.
  display?: string;
}

const WORKSPACE_INDEX_JUMPS: readonly KeybindingDef[] = Array.from({ length: 9 }, (_, i) => ({
  id: `workspace.jump.${i + 1}`,
  label: `Jump to workspace #${i + 1}`,
  category: "Workspace" as const,
  keys: `$mod+${i + 1}`,
  display: `⌘${i + 1}`,
}));

export const KEYBINDINGS: readonly KeybindingDef[] = [
  // Workspace & Navigation
  { id: "workspace.next", label: "Next workspace", category: "Workspace", keys: "$mod+]", display: "⌘]" },
  { id: "workspace.prev", label: "Previous workspace", category: "Workspace", keys: "$mod+[", display: "⌘[" },
  { id: "workspace.new", label: "New workspace", category: "Workspace", keys: "$mod+n", display: "⌘N" },
  { id: "workspace.close", label: "Close active workspace", category: "Workspace", keys: "$mod+w", display: "⌘W" },
  ...WORKSPACE_INDEX_JUMPS,
  { id: "project.new", label: "Add project", category: "Workspace", keys: "$mod+Shift+n", display: "⌘⇧N" },
  { id: "project-settings.open", label: "Project Settings: Open for active workspace", category: "Workspace", keys: "$mod+Shift+,", display: "⌘⇧," },
  { id: "project-settings.edit-file", label: "Project Settings: Edit maverick.json", category: "Workspace", keys: "" },

  // Editor modes
  { id: "editor.toggleMode", label: "Toggle Agent ↔ Terminal", category: "Editor", keys: "$mod+t", display: "⌘T" },
  { id: "editor.focusInput", label: "Focus input bar", category: "Editor", keys: "$mod+l", display: "⌘L" },
  { id: "ai.review", label: "AI Code Review of working changes", category: "Editor", keys: "$mod+Shift+r", display: "⌘⇧R" },
  { id: "preview.open", label: "Open Preview tab", category: "Editor", keys: "$mod+Shift+v", display: "⌘⇧V" },
  { id: "preview.toggleMarkdown", label: "Toggle Markdown raw ↔ preview", category: "Editor", keys: "$mod+Shift+m", display: "⌘⇧M" },

  // Browser
  { id: "browser.toggleInspect", label: "Toggle element inspector", category: "Global", keys: "$mod+Shift+i", display: "⌘⇧I" },

  // Terminal mode splits
  { id: "terminal.splitH", label: "Split horizontally", category: "Terminal", keys: "$mod+d", display: "⌘D" },
  { id: "terminal.splitV", label: "Split vertically", category: "Terminal", keys: "$mod+Shift+d", display: "⌘⇧D" },
  { id: "terminal.closePane", label: "Close terminal pane", category: "Terminal", keys: "$mod+Shift+w", display: "⌘⇧W" },
  { id: "terminal.clear", label: "Clear terminal", category: "Terminal", keys: "$mod+k", display: "⌘K" },
  { id: "terminal.openBottomTerminal", label: "Open bottom terminal", category: "Terminal", keys: "$mod+Shift+t", display: "⌘⇧T" },
  { id: "terminal.focusLeft", label: "Focus pane left", category: "Terminal", keys: "$mod+Alt+ArrowLeft", display: "⌘⌥←" },
  { id: "terminal.focusRight", label: "Focus pane right", category: "Terminal", keys: "$mod+Alt+ArrowRight", display: "⌘⌥→" },
  { id: "terminal.focusUp", label: "Focus pane up", category: "Terminal", keys: "$mod+Alt+ArrowUp", display: "⌘⌥↑" },
  { id: "terminal.focusDown", label: "Focus pane down", category: "Terminal", keys: "$mod+Alt+ArrowDown", display: "⌘⌥↓" },

  // Panel toggles
  { id: "layout.toggleSidebar", label: "Toggle primary sidebar", category: "Panel", keys: "$mod+b", display: "⌘B" },
  { id: "layout.toggleAuxBar", label: "Toggle auxiliary panel", category: "Panel", keys: "$mod+Shift+.", display: "⌘⇧." },
  { id: "layout.togglePanel", label: "Toggle bottom panel", category: "Panel", keys: "$mod+j", display: "⌘J" },

  // Activity views
  { id: "view.git", label: "Show Git", category: "Panel", keys: "$mod+Shift+g", display: "⌘⇧G" },
  { id: "view.kanban", label: "Show Kanban", category: "Panel", keys: "$mod+Shift+k", display: "⌘⇧K" },
  { id: "view.browser", label: "Show Browser", category: "Panel", keys: "$mod+Shift+b", display: "⌘⇧B" },
  { id: "view.automations", label: "Show Automations", category: "Panel", keys: "$mod+Shift+a", display: "⌘⇧A" },

  // Global
  { id: "global.commandPalette", label: "Command palette", category: "Global", keys: "$mod+Shift+p", display: "⌘⇧P" },
  { id: "global.quickOpen", label: "Quick open file", category: "Global", keys: "$mod+p", display: "⌘P" },
  { id: "global.presets", label: "Preset launcher", category: "Global", keys: "$mod+Shift+Space", display: "⌘⇧Space" },
  { id: "global.settings", label: "Open Settings", category: "Global", keys: "$mod+,", display: "⌘," },
  { id: "global.help", label: "Keybinding reference", category: "Global", keys: "$mod+Shift+/", display: "⌘⇧?" },
] as const;

export type ActionId = (typeof KEYBINDINGS)[number]["id"];

export function getKeybinding(id: string): KeybindingDef | undefined {
  return KEYBINDINGS.find((k) => k.id === id);
}
