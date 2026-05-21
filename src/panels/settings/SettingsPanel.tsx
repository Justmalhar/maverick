import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useSettingsStore } from "@/lib/stores/settings";
import { open as openInShell } from "@tauri-apps/plugin-shell";
import { SettingsNavRail, NAV_GROUPS, type SectionId } from "./SettingsNavRail";
import { SettingsHeader } from "./SettingsHeader";
import { SettingsFooter } from "./SettingsFooter";
import GeneralSettings from "./sections/GeneralSettings";
import ModelsSettings from "./sections/ModelsSettings";
import ProvidersSettings from "./sections/ProvidersSettings";
import AppearanceSettings from "./sections/AppearanceSettings";
import KeybindingsSettings from "./sections/KeybindingsSettings";
import TerminalPresets from "./sections/TerminalPresets";
import NotificationsSettings from "./sections/NotificationsSettings";
import AdvancedSettings from "./sections/AdvancedSettings";
import GitSettings from "./sections/GitSettings";
import MCPsSettings from "./sections/MCPsSettings";
import SkillsSettings from "./sections/SkillsSettings";
import VersionSettings from "./sections/VersionSettings";

interface SectionMeta {
  title: string;
  description: string;
  badge?: string;
  Component: React.ComponentType;
}

const SECTIONS: Record<SectionId, SectionMeta> = {
  general: {
    title: "General",
    description: "Defaults for new workspaces, base branches, and startup behaviour.",
    Component: GeneralSettings,
  },
  git: {
    title: "Git",
    description: "Remote, commit template, auto-fetch, and signing preferences.",
    Component: GitSettings,
  },
  models: {
    title: "Models",
    description: "Model IDs, context windows, and per-token cost per backend.",
    Component: ModelsSettings,
  },
  providers: {
    title: "Providers",
    description: "Backend credentials read from each CLI's own config.",
    Component: ProvidersSettings,
  },
  mcps: {
    title: "MCP Servers",
    description: "Globally enabled MCP servers and their environment.",
    Component: MCPsSettings,
  },
  skills: {
    title: "Skills",
    description: "Reusable prompt + tool bundles available across every workspace.",
    Component: SkillsSettings,
  },
  appearance: {
    title: "Appearance",
    description: "Theme, font sizes, ligatures, and animations.",
    Component: AppearanceSettings,
  },
  keybindings: {
    title: "Keybindings",
    description: "Every shortcut Maverick listens for. Rebinding lands in a later release.",
    Component: KeybindingsSettings,
  },
  terminal: {
    title: "Terminal Presets",
    description: "Named PTY launchers usable from the preset launcher (⌘⇧Space).",
    Component: TerminalPresets,
  },
  notifications: {
    title: "Notifications",
    description: "Per-event notification toggles.",
    Component: NotificationsSettings,
  },
  advanced: {
    title: "Advanced",
    description: "Performance limits, power management, telemetry.",
    Component: AdvancedSettings,
  },
  version: {
    title: "Version",
    description: "Build info and update channel.",
    Component: VersionSettings,
  },
};

const ALL_IDS: SectionId[] = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id));

function readSectionFromUrl(): SectionId {
  if (typeof window === "undefined") return "general";
  const id = new URLSearchParams(window.location.search).get("settings");
  return (ALL_IDS as string[]).includes(id ?? "") ? (id as SectionId) : "general";
}

interface Props {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
}

export default function SettingsPanel({ open, onOpenChange, onClose }: Props) {
  const [section, setSection] = useState<SectionId>(readSectionFromUrl());
  const status = useSettingsStore((s) => s.status);
  const lastError = useSettingsStore((s) => s.lastError);
  const isOpen = open ?? true;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("settings", section);
    window.history.replaceState({}, "", url.toString());
  }, [section]);

  const meta = SECTIONS[section];
  const ContentComponent = useMemo(() => meta.Component, [meta]);

  const handleOpenChange = (next: boolean) => {
    onOpenChange?.(next);
    if (!next) onClose?.();
  };

  const handleOpenFile = () => {
    void openInShell("file://~/.config/maverick/settings.json").catch(() => {
      console.warn("Could not open settings file");
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="settings-panel"
        className="grid h-[min(680px,86vh)] w-[92vw] !max-w-[960px] grid-cols-[240px_1fr] grid-rows-[1fr_auto] gap-0 overflow-hidden bg-popover/95 p-0 shadow-modal backdrop-blur-xl"
        style={{ border: "1px solid hsl(var(--border))" }}
      >
        <DialogTitle className="sr-only">{meta.title}</DialogTitle>
        <DialogDescription className="sr-only">{meta.description}</DialogDescription>
        <div className="row-span-2" style={{ borderRight: "1px solid hsl(var(--border))" }}>
          <SettingsNavRail section={section} onSelect={setSection} onOpenFile={handleOpenFile} />
        </div>
        <div className="overflow-y-auto px-8 py-6">
          <SettingsHeader title={meta.title} description={meta.description} badge={meta.badge} />
          <AnimatePresence mode="wait">
            <motion.div
              key={section}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
            >
              <ContentComponent />
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="col-start-2">
          <SettingsFooter status={status} errorMessage={lastError ?? undefined} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
