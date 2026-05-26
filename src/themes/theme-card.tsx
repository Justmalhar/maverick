import type { ThemeDefinition } from "@/lib/ipc";
import { cn } from "@/lib/utils";

function themeBackground(colors?: Record<string, string>, ui?: Record<string, string>): string {
  /* v8 ignore next */
  return colors?.["editor.background"] ?? ui?.["bg-base"] ?? "hsl(var(--background))";
}

function themeAccent(colors?: Record<string, string>, ui?: Record<string, string>): string {
  /* v8 ignore next */
  return colors?.["activityBar.activeBorder"] ?? ui?.["accent"] ?? "hsl(var(--accent))";
}

function themeForeground(colors?: Record<string, string>, ui?: Record<string, string>): string {
  /* v8 ignore next */
  return colors?.["editor.foreground"] ?? ui?.["text-primary"] ?? "hsl(var(--foreground))";
}

export function themeSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}

interface ThemeCardProps {
  theme: ThemeDefinition;
  selected: boolean;
  onSelect: () => void;
}

export function ThemeCard({ theme, selected, onSelect }: ThemeCardProps) {
  const bg = themeBackground(theme.colors, theme.ui);
  const accent = themeAccent(theme.colors, theme.ui);
  const fg = themeForeground(theme.colors, theme.ui);
  const slug = themeSlug(theme.name);

  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`theme-${slug}`}
      aria-pressed={selected}
      aria-label={`Apply theme ${slug}`}
      className={cn(
        "flex flex-col gap-1 rounded-md p-2 text-left text-[11px] transition-colors",
        selected ? "ring-1 ring-accent/60" : ""
      )}
      style={{
        border: selected ? "1px solid hsl(var(--accent))" : "1px solid hsl(var(--border))",
      }}
    >
      <div
        className="h-10 w-full rounded"
        style={{ background: bg, border: "1px solid hsl(var(--border))" }}
      >
        <div className="flex h-full items-center justify-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: fg }} />
          <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
        </div>
      </div>
      <span className="truncate">{theme.name}</span>
    </button>
  );
}
