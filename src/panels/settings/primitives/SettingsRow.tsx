import type { ReactNode } from "react";

interface Props {
  title: string;
  description?: string;
  control: ReactNode;
}

export function SettingsRow({ title, description, control }: Props) {
  return (
    <div className="flex items-start justify-between gap-6 py-4">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-[13px] font-medium text-foreground">{title}</div>
        {description ? (
          <div
            data-testid="settings-row-description"
            className="max-w-prose text-xs leading-relaxed text-muted-foreground"
          >
            {description}
          </div>
        ) : null}
      </div>
      {/* Cap the control column so a wide control (e.g. a long file path) can
          never crush the title/description column into one-word-per-line. */}
      <div className="flex min-w-0 max-w-[60%] shrink-0 items-center">{control}</div>
    </div>
  );
}
