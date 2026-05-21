// Single source of truth for default values of every SettingsKey.
// Sections and the JSON editor both read from here so the JSON view shows
// every known key — even the ones the user hasn't explicitly set.

import type { SettingsKey, SettingsValue } from "@/lib/ipc";

export const SETTINGS_DEFAULTS: Record<SettingsKey, SettingsValue> = {
  // General
  "general.defaultBackend": "claude",
  "general.defaultBackendBinPath": "",
  "general.defaultBranch": "origin/main",
  "general.namingScheme": "maverick/{feature-name}",
  "general.restoreSession": true,

  // Appearance
  "appearance.theme": "",
  "appearance.uiFontSize": 12,
  "appearance.terminalFontSize": 13,
  "appearance.ligatures": true,
  "appearance.animations": true,
  "appearance.customColors.background": "",
  "appearance.customColors.foreground": "",
  "appearance.customColors.accent": "",
  "appearance.customColors.muted": "",
  "appearance.customColors.border": "",
  "appearance.customColors.card": "",
  "appearance.customColors.sidebar": "",
  "appearance.customColors.statusbar": "",

  // Notifications
  "notifications.agent.waiting": true,
  "notifications.agent.complete": true,
  "notifications.agent.error": true,
  "notifications.build.result": true,
  "notifications.quota.warning": true,

  // Git
  "git.remote": "origin",
  "git.template": "",
  "git.autoFetchMinutes": 5,
  "git.gpgSign": false,

  // Models
  "models.claude.id": "claude-opus-4-7",
  "models.codex.id": "gpt-5",
  "models.gemini.id": "gemini-2.5-pro",
  "models.pi.id": "pi-1",

  // Terminal launch commands
  "terminal.claude.command": "claude --continue",
  "terminal.codex.command": "codex",
  "terminal.gemini.command": "gemini",
  "terminal.pi.command": "pi",

  // Advanced
  "advanced.largeTextThreshold": 5000,
  "advanced.lruLimit": 8,
  "advanced.caffeinate": true,

  // Version
  "version.updateChannel": "stable",
};

export const SETTINGS_KEYS: readonly SettingsKey[] = Object.keys(
  SETTINGS_DEFAULTS,
) as SettingsKey[];
