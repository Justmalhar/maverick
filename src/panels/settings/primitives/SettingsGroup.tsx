import type { ReactNode } from "react";

interface Props {
  title?: string;
  description?: string;
  children: ReactNode;
}

export function SettingsGroup({ title, description, children }: Props) {
  return (
    <section className="rounded-lg border border-border/60 bg-card/40 px-5 py-2">
      {title || description ? (
        <header className="border-b border-border/40 py-3">
          {title ? (
            <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
              {title}
            </h3>
          ) : null}
          {description ? (
            <p className="mt-1 max-w-prose text-xs text-muted-foreground">{description}</p>
          ) : null}
        </header>
      ) : null}
      <div className="divide-y divide-border/40">{children}</div>
    </section>
  );
}
