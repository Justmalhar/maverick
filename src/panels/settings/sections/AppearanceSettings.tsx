// Theme picker, font size (UI + terminal), ligatures, animations.
import { useState } from "react";
import { Button } from "@/components/ui/button";
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
  const [theme, setTheme] = useState("pure-black");
  const [uiFontSize, setUiFontSize] = useState(12);
  const [terminalFontSize, setTerminalFontSize] = useState(13);
  const [ligatures, setLigatures] = useState(true);
  const [animations, setAnimations] = useState(true);

  return (
    <section data-testid="appearance-settings" className="space-y-3">
      <h3 className="text-sm font-medium text-foreground">Appearance</h3>

      <div>
        <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
          Theme
        </label>
        <div className="mt-1.5 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id)}
              data-testid={`theme-${t.id}`}
              className={cn(
                "flex flex-col gap-1 rounded-sm border p-2 text-left text-[11px] transition-colors",
                theme === t.id ? "border-primary ring-1 ring-primary" : "border-border"
              )}
            >
              <div
                className="h-10 w-full rounded-sm border border-border"
                style={{ background: t.background }}
              >
                <div className="flex h-full items-center justify-center gap-1">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: t.foreground }}
                  />
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: t.accent }}
                  />
                </div>
              </div>
              <span>{t.name}</span>
            </button>
          ))}
        </div>
      </div>

      <Row label={`UI font size (${uiFontSize}px)`}>
        <input
          type="range"
          min={10}
          max={18}
          value={uiFontSize}
          data-testid="ui-font-size"
          onChange={(e) => setUiFontSize(Number(e.target.value))}
          className="w-full"
        />
      </Row>

      <Row label={`Terminal font size (${terminalFontSize}px)`}>
        <input
          type="range"
          min={10}
          max={20}
          value={terminalFontSize}
          data-testid="terminal-font-size"
          onChange={(e) => setTerminalFontSize(Number(e.target.value))}
          className="w-full"
        />
      </Row>

      <Row label="Font ligatures">
        <Button
          variant={ligatures ? "default" : "outline"}
          size="sm"
          onClick={() => setLigatures((s) => !s)}
          data-testid="ligatures-toggle"
        >
          {ligatures ? "On" : "Off"}
        </Button>
      </Row>

      <Row label="Animations">
        <Button
          variant={animations ? "default" : "outline"}
          size="sm"
          onClick={() => setAnimations((s) => !s)}
          data-testid="animations-toggle"
        >
          {animations ? "On" : "Off"}
        </Button>
      </Row>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[200px_1fr] items-center gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
