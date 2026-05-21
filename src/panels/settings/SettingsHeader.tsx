interface Props {
  title: string;
  description?: string;
  badge?: string;
}

export function SettingsHeader({ title, description, badge }: Props) {
  return (
    <header className="mb-5 border-b border-border/40 pb-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {badge ? (
          <span className="rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {badge}
          </span>
        ) : null}
      </div>
      {description ? (
        <p className="mt-1 max-w-prose text-xs text-muted-foreground">{description}</p>
      ) : null}
      <div className="mt-3 h-px w-full bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
    </header>
  );
}
