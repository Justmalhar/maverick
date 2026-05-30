import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import type { ThemeDefinition } from "@/lib/ipc";
import MaverickDark from "./definitions/maverick-dark.json";
import MaverickLight from "./definitions/maverick-light.json";
import GithubDarkClassic from "./definitions/github-dark-classic.json";
import GithubDark from "./definitions/github-dark.json";
import GithubLight from "./definitions/github-light.json";
import OneDarkPro from "./definitions/one-dark-pro.json";
import Dracula from "./definitions/dracula.json";
import Nord from "./definitions/nord.json";
import CatppuccinMocha from "./definitions/catppuccin-mocha.json";
import CatppuccinLatte from "./definitions/catppuccin-latte.json";
import TokyoNight from "./definitions/tokyo-night.json";
import MonokaiPro from "./definitions/monokai-pro.json";
import SolarizedDark from "./definitions/solarized-dark.json";
import GruvboxDark from "./definitions/gruvbox-dark.json";

const BUILTIN_THEMES: ThemeDefinition[] = [
  MaverickDark as ThemeDefinition,
  MaverickLight as ThemeDefinition,
  GithubDarkClassic as ThemeDefinition,
  GithubDark as ThemeDefinition,
  GithubLight as ThemeDefinition,
  OneDarkPro as ThemeDefinition,
  Dracula as ThemeDefinition,
  Nord as ThemeDefinition,
  CatppuccinMocha as ThemeDefinition,
  CatppuccinLatte as ThemeDefinition,
  TokyoNight as ThemeDefinition,
  MonokaiPro as ThemeDefinition,
  SolarizedDark as ThemeDefinition,
  GruvboxDark as ThemeDefinition,
];

interface ThemeContextValue {
  theme: ThemeDefinition;
  themes: ThemeDefinition[];
  setTheme: (def: ThemeDefinition) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function slugify(name: string) {
  return name.toLowerCase().replace(/\s+/g, "-");
}

// ── VSCode theme → our Tailwind CSS custom properties ──────────────────────

function rgbToHsl(r: number, g: number, b: number): string {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / delta + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / delta + 2) / 6;
    else h = ((rn - gn) / delta + 4) / 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function colorToHsl(val: string): string | null {
  if (!val) return null;
  // #RRGGBB or #RRGGBBAA
  if (val.startsWith("#")) {
    const clean = val.slice(1, 7);
    if (clean.length < 6) return null;
    return rgbToHsl(parseInt(clean.slice(0,2),16), parseInt(clean.slice(2,4),16), parseInt(clean.slice(4,6),16));
  }
  // rgba(R, G, B, A) or rgb(R, G, B)
  const m = val.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) return rgbToHsl(parseInt(m[1]), parseInt(m[2]), parseInt(m[3]));
  return null;
}

function hexToHsl(hex: string): string {
  return colorToHsl(hex) ?? "0 0% 50%";
}

// Maps legacy ui keys to one or more of our CSS custom property names.
const LEGACY_MAP: Array<[string, string | string[]]> = [
  ["bg-base",     ["background", "editor-bg", "tab-active-bg", "titlebar-bg", "activitybar-bg", "statusbar-bg", "statusbar-no-folder-bg", "sidebar-hover"]],
  ["bg-sidebar",  ["sidebar-bg", "tab-inactive-bg", "card", "popover", "input", "muted", "secondary"]],
  ["accent",      ["accent", "activitybar-active-border", "tab-active-border", "ring", "primary", "statusbar-prominent-bg", "diff-rename", "info"]],
  ["accent-muted",["sidebar-selected"]],
  ["text-primary",["foreground", "tab-fg-active", "card-foreground", "popover-foreground", "activitybar-fg-active", "sidebar-fg", "statusbar-fg"]],
  ["text-muted",  ["muted-foreground", "tab-fg", "sidebar-section-header", "activitybar-fg"]],
  ["border",      ["border", "border-glass", "border-strong", "border-glass-strong"]],
  ["success",     ["diff-add", "success"]],
  ["error",       ["destructive", "diff-delete"]],
  ["warn",        ["warning", "diff-modify"]],
];

function applyLegacyTheme(def: ThemeDefinition) {
  const root = document.documentElement;
  const ui = def.ui!;

  for (const [uiKey, tokenKeys] of LEGACY_MAP) {
    const val = ui[uiKey];
    if (!val) continue;
    const hsl = colorToHsl(val);
    if (!hsl) continue;
    const keys = Array.isArray(tokenKeys) ? tokenKeys : [tokenKeys];
    for (const k of keys) root.style.setProperty(`--${k}`, hsl);
  }

  // Derive diff bg from diff fg (same hue/sat, very low lightness)
  for (const [fg, bg] of [["diff-add", "diff-add-bg"], ["diff-delete", "diff-delete-bg"], ["diff-modify", "diff-modify-bg"], ["diff-rename", "diff-rename-bg"]] as const) {
    const fgVal = root.style.getPropertyValue(`--${fg}`);
    if (fgVal) {
      const [h, s] = fgVal.split(" ");
      root.style.setProperty(`--${bg}`, `${h} ${s} 10%`);
    }
  }

  const fixed = def.type === "dark" ? DARK_FIXED : LIGHT_FIXED;
  for (const [k, v] of Object.entries(fixed)) root.style.setProperty(`--${k}`, v);
  applyDerivedForegrounds(root);

  root.setAttribute("data-theme", slugify(def.name));
}

// Maps VSCode color IDs to one or more of our CSS custom property names.
const VSCODE_MAP: Array<[string, string | string[]]> = [
  ["titleBar.activeBackground",         "titlebar-bg"],
  ["activityBar.background",            "activitybar-bg"],
  ["activityBar.inactiveForeground",    "activitybar-fg"],
  ["activityBar.foreground",            "activitybar-fg-active"],
  ["activityBar.activeBorder",          ["activitybar-active-border", "accent", "tab-active-border"]],
  ["sideBar.background",                ["sidebar-bg", "tab-inactive-bg"]],
  ["sideBar.foreground",                "sidebar-fg"],
  ["descriptionForeground",             ["sidebar-section-header", "muted-foreground", "tab-fg"]],
  ["list.hoverBackground",              "sidebar-hover"],
  ["list.activeSelectionBackground",    "sidebar-selected"],
  ["list.activeSelectionForeground",    "sidebar-selected-fg"],
  ["editor.background",                 ["background", "editor-bg", "tab-active-bg"]],
  ["editor.foreground",                 ["foreground", "tab-fg-active", "card-foreground", "popover-foreground"]],
  ["statusBar.background",              ["statusbar-bg", "statusbar-no-folder-bg"]],
  ["statusBar.foreground",              "statusbar-fg"],
  ["statusBarItem.prominentBackground", "statusbar-prominent-bg"],
  ["dropdown.background",               ["card", "popover", "input"]],
  ["list.inactiveSelectionBackground",  ["muted", "secondary"]],
  ["progressBar.background",            ["primary", "ring"]],
  ["sideBar.border",                    ["border", "border-glass"]],
  ["pickerGroup.border",                ["border-strong", "border-glass-strong"]],
  ["errorForeground",                   "destructive"],
  ["notificationsWarningIcon.foreground", "warning"],
  ["notificationsInfoIcon.foreground",  "info"],
  ["gitDecoration.addedResourceForeground",   ["diff-add", "success"]],
  ["gitDecoration.deletedResourceForeground", "diff-delete"],
  ["gitDecoration.modifiedResourceForeground","diff-modify"],
  ["gitDecoration.submoduleResourceForeground","diff-rename"],
];

// Fixed-value tokens whose values are derived from theme type, not a VSCode key.
// primary-foreground and accent-foreground are derived dynamically from the
// lightness of their base color (see applyDerivedForegrounds) — required so
// themes whose primary/accent is white (e.g. Maverick Dark) get a black
// foreground instead of white-on-white.
const DARK_FIXED: Record<string, string> = {
  "secondary-foreground":  "0 0% 96%",
  "destructive-foreground":"0 0% 100%",
};
const LIGHT_FIXED: Record<string, string> = {
  "secondary-foreground":  "0 0% 4%",
  "destructive-foreground":"0 0% 100%",
};

function lightnessOfTriple(triple: string): number | null {
  const parts = triple.trim().split(/\s+/);
  if (parts.length < 3) return null;
  const l = parseFloat(parts[2]);
  return Number.isFinite(l) ? l : null;
}

function applyDerivedForegrounds(root: HTMLElement) {
  for (const [base, fgKey, alwaysDerive] of [
    ["primary", "primary-foreground", true],
    ["accent", "accent-foreground", true],
    // Only derive sidebar-selected-fg when the theme didn't supply
    // list.activeSelectionForeground (i.e. the property is still at its
    // default white). This keeps theme-author overrides intact.
    ["sidebar-selected", "sidebar-selected-fg", false],
  ] as const) {
    const val = root.style.getPropertyValue(`--${base}`);
    const l = val ? lightnessOfTriple(val) : null;
    if (l == null) continue;
    if (!alwaysDerive) {
      const existing = root.style.getPropertyValue(`--${fgKey}`).trim();
      if (existing && existing !== "0 0% 100%") continue;
    }
    root.style.setProperty(`--${fgKey}`, l > 55 ? "0 0% 0%" : "0 0% 100%");
  }
}

function applyVSCodeTheme(def: ThemeDefinition) {
  const root = document.documentElement;
  const colors = def.colors!;

  for (const [vsKey, tokenKeys] of VSCODE_MAP) {
    const hex = colors[vsKey];
    if (!hex || !hex.startsWith("#")) continue;
    const hsl = hexToHsl(hex);
    const keys = Array.isArray(tokenKeys) ? tokenKeys : [tokenKeys];
    for (const k of keys) root.style.setProperty(`--${k}`, hsl);
  }

  // Derive diff bg from diff fg (same hue, very low lightness)
  for (const [fg, bg] of [["diff-add", "diff-add-bg"], ["diff-delete", "diff-delete-bg"], ["diff-modify", "diff-modify-bg"], ["diff-rename", "diff-rename-bg"]] as const) {
    const fgVal = root.style.getPropertyValue(`--${fg}`);
    if (fgVal) {
      const [h, s] = fgVal.split(" ");
      root.style.setProperty(`--${bg}`, `${h} ${s} 10%`);
    }
  }

  const fixed = def.type === "dark" ? DARK_FIXED : LIGHT_FIXED;
  for (const [k, v] of Object.entries(fixed)) root.style.setProperty(`--${k}`, v);
  applyDerivedForegrounds(root);

  root.setAttribute("data-theme", slugify(def.name));
}

function applyToRoot(def: ThemeDefinition) {
  if (def.colors) {
    applyVSCodeTheme(def);
  } else {
    applyLegacyTheme(def);
  }
}

// ───────────────────────────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeDefinition>(BUILTIN_THEMES[0]!);

  useLayoutEffect(() => {
    applyToRoot(theme);
  }, [theme]);

  const setTheme = useCallback((def: ThemeDefinition) => {
    setThemeState(def);
  }, []);

  const value = useMemo(
    () => ({ theme, themes: BUILTIN_THEMES, setTheme }),
    [theme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeContext must be used inside ThemeProvider");
  return ctx;
}
