import { useThemeContext } from "@/themes/theme-provider";
import { bootstrapUpdateSettings } from "@/lib/tauri";
import { cn } from "@/lib/utils";

function slugify(name: string) {
  return name.toLowerCase().replace(/\s+/g, "-");
}

export function ThemeStep() {
  const { theme, themes, setTheme } = useThemeContext();

  async function apply(t: typeof theme) {
    setTheme(t);
    await bootstrapUpdateSettings({ theme: slugify(t.name) });
  }

  return (
    <div data-testid="firstrun-step-theme" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">Pick a theme</h2>
        <p className="text-[12px] text-muted-foreground">
          Click any tile to apply. You can switch any time from Settings → Appearance.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {themes.map((t) => {
          const active = slugify(t.name) === slugify(theme.name);
          return (
            <button
              key={t.name}
              type="button"
              aria-label={`Apply theme ${slugify(t.name)}`}
              onClick={() => void apply(t)}
              className={cn(
                "flex flex-col items-start gap-1 rounded-md border px-3 py-2 text-left transition-colors",
                active ? "border-primary bg-primary/10" : "border-border bg-muted/30 hover:bg-muted"
              )}
            >
              <span className="text-[12px] text-foreground">{t.name}</span>
              <span className="text-[10px] text-muted-foreground">{t.type}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
