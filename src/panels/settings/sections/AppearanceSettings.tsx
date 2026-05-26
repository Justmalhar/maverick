import { useEffect } from "react";
import { SettingsGroup } from "../primitives/SettingsGroup";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsToggle } from "../primitives/SettingsToggle";
import { useSettings, useSettingsStore } from "@/lib/stores/settings";
import { useThemeContext } from "@/themes/theme-provider";
import { ThemeCard } from "@/themes/theme-card";
import type { SettingsKey } from "@/lib/ipc";
import { Button } from "@/components/ui/button";

interface CustomColor {
  key: SettingsKey;
  cssVar: string;
  label: string;
}

// Hex → "h s% l%" string for our HSL-based CSS variables.
function hexToHslTriple(hex: string): string | null {
  const m = /^#?([a-f\d]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

const CUSTOM_COLORS: CustomColor[] = [
  { key: "appearance.customColors.background", cssVar: "--background", label: "Background" },
  { key: "appearance.customColors.foreground", cssVar: "--foreground", label: "Foreground" },
  { key: "appearance.customColors.accent", cssVar: "--accent", label: "Accent" },
  { key: "appearance.customColors.muted", cssVar: "--muted", label: "Muted" },
  { key: "appearance.customColors.border", cssVar: "--border", label: "Border" },
  { key: "appearance.customColors.card", cssVar: "--card", label: "Card" },
  { key: "appearance.customColors.sidebar", cssVar: "--sidebar-bg", label: "Sidebar" },
  { key: "appearance.customColors.statusbar", cssVar: "--statusbar-bg", label: "Status bar" },
];

export default function AppearanceSettings() {
  const { theme, themes, setTheme } = useThemeContext();
  const [uiFontSize, setUiFontSize] = useSettings("appearance.uiFontSize", 12);
  const [terminalFontSize, setTerminalFontSize] = useSettings("appearance.terminalFontSize", 13);
  const [ligatures, setLigatures] = useSettings("appearance.ligatures", true);
  const [animations, setAnimations] = useSettings("appearance.animations", true);

  return (
    <div data-testid="appearance-settings" className="space-y-5">
      <SettingsGroup title="Theme" description="Affects UI surfaces, terminal palette, and syntax colors.">
        <div className="py-3">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {themes.map((t) => (
              <ThemeCard
                key={t.name}
                theme={t}
                selected={theme.name === t.name}
                onSelect={() => setTheme(t)}
              />
            ))}
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Typography">
        <SettingsRow
          title={`UI font size (${uiFontSize}px)`}
          control={
            <input
              type="range"
              min={10}
              max={18}
              value={uiFontSize}
              data-testid="ui-font-size"
              onChange={(e) => setUiFontSize(Number(e.target.value))}
              className="w-full max-w-sm"
            />
          }
        />
        <SettingsRow
          title={`Terminal font size (${terminalFontSize}px)`}
          control={
            <input
              type="range"
              min={10}
              max={20}
              value={terminalFontSize}
              data-testid="terminal-font-size"
              onChange={(e) => setTerminalFontSize(Number(e.target.value))}
              className="w-full max-w-sm"
            />
          }
        />
        <SettingsRow
          title="Font ligatures"
          control={
            <SettingsToggle
              label="Ligatures"
              checked={ligatures}
              onCheckedChange={setLigatures}
              data-testid="ligatures-toggle"
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Motion">
        <SettingsRow
          title="Animations"
          description="Honors system 'reduce motion' regardless of this setting."
          control={
            <SettingsToggle
              label="Animations"
              checked={animations}
              onCheckedChange={setAnimations}
              data-testid="animations-toggle"
            />
          }
        />
      </SettingsGroup>

      <CustomColorsGroup />
    </div>
  );
}

function CustomColorsGroup() {
  // Apply any saved overrides to the live :root on mount + on change.
  useEffect(() => {
    const apply = () => {
      const values = useSettingsStore.getState().values;
      for (const c of CUSTOM_COLORS) {
        const hex = (values[c.key] as string | undefined) ?? "";
        const hsl = hex ? hexToHslTriple(hex) : null;
        if (hsl) document.documentElement.style.setProperty(c.cssVar, hsl);
        else document.documentElement.style.removeProperty(c.cssVar);
      }
    };
    apply();
    return useSettingsStore.subscribe(apply);
  }, []);

  return (
    <SettingsGroup
      title="Custom colors"
      description="Hex overrides for individual CSS variables. Leave empty to inherit from the active theme."
    >
      {CUSTOM_COLORS.map((c) => (
        <CustomColorRow key={c.key} entry={c} />
      ))}
      <ResetCustomColors />
    </SettingsGroup>
  );
}

function CustomColorRow({ entry }: { entry: CustomColor }) {
  const [value, setValue] = useSettings(entry.key, "");
  const hex = value || "";
  return (
    <SettingsRow
      title={entry.label}
      description={entry.cssVar}
      control={
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={hex || "#000000"}
            onChange={(e) => setValue(e.target.value)}
            data-testid={`color-${entry.key}`}
            className="h-7 w-10 cursor-pointer rounded border border-border/60 bg-transparent p-0"
          />
          <input
            type="text"
            value={hex}
            onChange={(e) => setValue(e.target.value)}
            placeholder="#000000"
            className="h-7 w-24 rounded-md border border-border/60 bg-muted/40 px-2 font-mono text-xs"
          />
          {hex ? (
            <button
              type="button"
              onClick={() => setValue("")}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Reset
            </button>
          ) : null}
        </div>
      }
    />
  );
}

function ResetCustomColors() {
  const setValue = useSettingsStore((s) => s.set);
  const clearAll = () => {
    for (const c of CUSTOM_COLORS) setValue(c.key, "");
  };
  return (
    <div className="flex justify-end py-3">
      <Button variant="outline" size="sm" onClick={clearAll}>
        Reset all custom colors
      </Button>
    </div>
  );
}
