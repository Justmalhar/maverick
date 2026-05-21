import { SettingsGroup } from "../primitives/SettingsGroup";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsToggle } from "../primitives/SettingsToggle";
import { useSettings } from "@/lib/stores/settings";
import { cn } from "@/lib/utils";

interface ThemePreview {
  id: string;
  name: string;
  background: string;
  foreground: string;
  accent: string;
}

const THEMES: ThemePreview[] = [
  { id: "pure-black", name: "Pure Black", background: "#000000", foreground: "#ffffff", accent: "#7c3aed" },
  { id: "graphite", name: "Graphite", background: "#0c0c0c", foreground: "#e7e7e7", accent: "#22d3ee" },
  { id: "nord", name: "Nord", background: "#2e3440", foreground: "#eceff4", accent: "#88c0d0" },
  { id: "rose-pine", name: "Rosé Pine", background: "#191724", foreground: "#e0def4", accent: "#eb6f92" },
  { id: "solarized-light", name: "Solarized Light", background: "#fdf6e3", foreground: "#073642", accent: "#268bd2" },
];

export default function AppearanceSettings() {
  const [theme, setTheme] = useSettings("appearance.theme", "pure-black");
  const [uiFontSize, setUiFontSize] = useSettings("appearance.uiFontSize", 12);
  const [terminalFontSize, setTerminalFontSize] = useSettings("appearance.terminalFontSize", 13);
  const [ligatures, setLigatures] = useSettings("appearance.ligatures", true);
  const [animations, setAnimations] = useSettings("appearance.animations", true);

  return (
    <div data-testid="appearance-settings" className="space-y-5">
      <SettingsGroup title="Theme" description="Affects UI surfaces, terminal palette, and syntax colors.">
        <div className="py-3">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {THEMES.map((t) => {
              const selected = theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTheme(t.id)}
                  data-testid={`theme-${t.id}`}
                  aria-pressed={selected}
                  className={cn(
                    "flex flex-col gap-1 rounded-md border p-2 text-left text-[11px] transition-colors",
                    selected
                      ? "border-accent ring-1 ring-accent/60"
                      : "border-border/60 hover:border-border",
                  )}
                >
                  <div
                    className="h-10 w-full rounded border border-border/60"
                    style={{ background: t.background }}
                  >
                    <div className="flex h-full items-center justify-center gap-1">
                      <span className="h-2 w-2 rounded-full" style={{ background: t.foreground }} />
                      <span className="h-2 w-2 rounded-full" style={{ background: t.accent }} />
                    </div>
                  </div>
                  <span>{t.name}</span>
                </button>
              );
            })}
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
    </div>
  );
}
