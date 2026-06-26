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
  // JSON-encoded Record<string,string> of global env vars merged into every PTY.
  "general.env": "{}",
  // Command auto-run in each new workspace terminal (e.g. "claude
  // --dangerously-skip-permissions"). Blank → use the default backend's command.
  "general.startupCommand": "",
  // Use the agent CLI to name task branches (feature-name in the scheme) instead
  // of a title slug. Falls back to the slug if the CLI is slow/unavailable.
  "general.aiBranchNames": true,
  // Where a task/workspace agent runs: "headless" (background, streamed to the
  // Agent Output panel — the default) or "terminal" (typed into an interactive PTY).
  "general.agentLaunchMode": "headless",

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
  // Default shell new terminals launch under (Windows: powershell | cmd | wsl).
  "terminal.defaultShell": "powershell",

  // Advanced
  "advanced.largeTextThreshold": 5000,
  "advanced.lruLimit": 8,
  "advanced.caffeinate": true,

  // Browser — "native" (real child webview; loads localhost + sites that refuse
  // iframing) or "iframe" (sandboxed, headless-testable, local dev previews only).
  "browser.engine": "native",

  // Version
  "version.updateChannel": "stable",
};

export const SETTINGS_KEYS: readonly SettingsKey[] = Object.keys(
  SETTINGS_DEFAULTS,
) as SettingsKey[];
