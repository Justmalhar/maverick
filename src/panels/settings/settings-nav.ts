import {
  Bell,
  Cpu,
  GitBranch,
  Info,
  Keyboard,
  Palette,
  Plug,
  Server,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Variable,
} from "lucide-react";
import type { ComponentType } from "react";

// Settings section nav model. Kept out of SettingsNavRail.tsx so that module
// exports only its component (Fast Refresh requirement); both the rail and the
// panel read this config.

export type SectionId =
  | "general"
  | "environment"
  | "git"
  | "models"
  | "providers"
  | "mcps"
  | "skills"
  | "appearance"
  | "keybindings"
  | "terminal"
  | "notifications"
  | "advanced"
  | "version";

export interface NavItem {
  id: SectionId;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "workspace",
    label: "Workspace",
    items: [
      { id: "general", label: "General", icon: SettingsIcon },
      { id: "environment", label: "Environment", icon: Variable },
      { id: "git", label: "Git", icon: GitBranch },
    ],
  },
  {
    id: "ai",
    label: "AI",
    items: [
      { id: "models", label: "Models", icon: Cpu },
      { id: "providers", label: "Providers", icon: Plug },
      { id: "mcps", label: "MCPs", icon: Server },
      { id: "skills", label: "Skills", icon: Sparkles },
    ],
  },
  {
    id: "editor",
    label: "Editor",
    items: [
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "keybindings", label: "Keybindings", icon: Keyboard },
      { id: "terminal", label: "Terminal", icon: Terminal },
    ],
  },
  {
    id: "system",
    label: "System",
    items: [
      { id: "notifications", label: "Notifications", icon: Bell },
      { id: "advanced", label: "Advanced", icon: SlidersHorizontal },
      { id: "version", label: "Version", icon: Info },
    ],
  },
];
