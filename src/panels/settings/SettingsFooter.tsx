import { Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusDot, type StatusDotProps } from "@/components/ui/status-dot";

type Status = "idle" | "saving" | "saved" | "error";

interface Props {
  status: Status;
  errorMessage?: string;
  onOpenFile: () => void;
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

export function SettingsFooter({ status, errorMessage, onOpenFile }: Props) {
  return (
    <footer className="flex h-11 items-center justify-between bg-card/40 px-4" style={{ borderTop: "1px solid hsl(var(--border))" }}>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-xs"
        onClick={onOpenFile}
      >
        <Code2 className="h-3.5 w-3.5" />
        Open settings file
      </Button>
      <div
        className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
        title={errorMessage}
      >
        <StatusDot variant={STATUS_VARIANT[status]} size="sm" />
        <span>{STATUS_LABEL[status]}</span>
      </div>
    </footer>
  );
}
