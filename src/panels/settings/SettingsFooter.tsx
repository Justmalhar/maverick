import { StatusDot, type StatusDotProps } from "@/components/ui/status-dot";

type Status = "idle" | "saving" | "saved" | "error";

interface Props {
  status: Status;
  errorMessage?: string;
}

const STATUS_LABEL: Record<Status, string> = {
  idle: "All changes saved",
  saving: "Saving…",
  saved: "Saved · just now",
  error: "Save failed · retry",
};

const STATUS_VARIANT: Record<Status, StatusDotProps["variant"]> = {
  idle: "idle",
  saving: "running",
  saved: "active",
  error: "error",
};

export function SettingsFooter({ status, errorMessage }: Props) {
  return (
    <footer
      className="flex h-9 items-center justify-end bg-muted/50 px-4"
      style={{ borderTop: "1px solid hsl(var(--border))" }}
    >
      <div
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
        title={errorMessage}
      >
        <StatusDot variant={STATUS_VARIANT[status]} size="sm" />
        <span data-testid="settings-status">{STATUS_LABEL[status]}</span>
      </div>
    </footer>
  );
}
