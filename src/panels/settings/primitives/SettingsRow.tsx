import type { ReactNode } from "react";

interface Props {
  title: string;
  description?: string;
  control: ReactNode;
}

export function SettingsRow({ title, description, control }: Props) {
  return (
    <div className="space-y-2 py-3 first:pt-0 last:pb-0">
      <div className="space-y-0.5">
        <div className="text-sm font-medium text-foreground">{title}</div>
        {description ? (
          <div
            data-testid="settings-row-description"
            className="max-w-prose text-xs text-muted-foreground"
          >
            {description}
          </div>
        ) : null}
      </div>
      <div>{control}</div>
    </div>
  );
}
