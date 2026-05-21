import type { ReactNode } from "react";

interface Props {
  title?: string;
  description?: string;
  children: ReactNode;
}

export function SettingsGroup({ title, description, children }: Props) {
  return (
    <section className="overflow-hidden rounded-xl bg-card/30" style={{ border: "1px solid hsl(var(--border))" }}>
      {title || description ? (
        <header className="bg-muted/20 px-5 py-3" style={{ borderBottom: "1px solid hsl(var(--border))" }}>
          {title ? (
            <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
          ) : null}
          {description ? (
            <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">{description}</p>
          ) : null}
        </header>
      ) : null}
      <div className="divide-y divide-border/30 px-5">{children}</div>
    </section>
  );
}
