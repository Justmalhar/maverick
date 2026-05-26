import { useThemeContext } from "@/themes/theme-provider";
import { ThemeCard, themeSlug } from "@/themes/theme-card";
import { bootstrapUpdateSettings } from "@/lib/tauri";

export function ThemeStep() {
  const { theme, themes, setTheme } = useThemeContext();

  async function apply(t: typeof theme) {
    setTheme(t);
    await bootstrapUpdateSettings({ theme: themeSlug(t.name) });
  }

  return (
    <div data-testid="firstrun-step-theme" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">Pick a theme</h2>
        <p className="text-[12px] text-muted-foreground">
          Click any tile to apply. You can switch any time from Settings → Appearance.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {themes.map((t) => (
          <ThemeCard
            key={t.name}
            theme={t}
            selected={themeSlug(theme.name) === themeSlug(t.name)}
            onSelect={() => void apply(t)}
          />
        ))}
      </div>
    </div>
  );
}
