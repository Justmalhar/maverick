interface Props {
  title: string;
  description?: string;
  badge?: string;
}

export function SettingsHeader({ title, description, badge }: Props) {
  return (
    <header className="mb-6">
      <div className="flex items-center gap-2.5">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
        {badge ? (
          <span className="rounded-full bg-muted/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground" style={{ border: "1px solid hsl(var(--border))" }}>
            {badge}
          </span>
        ) : null}
      </div>
      {description ? (
        <p className="mt-1.5 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
    </header>
  );
}
