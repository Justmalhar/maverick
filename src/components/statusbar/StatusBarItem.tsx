import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Tones map to background prominence — VSCode status bar uses a single
// foreground color for all items; "success"/"warning"/"destructive"/"info"
// are accepted as aliases for back-compat but render as default.
type StatusBarTone =
  | "default"
  | "prominent"
  | "success"
  | "warning"
  | "destructive"
  | "info";

interface Props {
  children: ReactNode;
  icon?: ReactNode;
  tone?: StatusBarTone;
  testId?: string;
  onClick?: () => void;
  className?: string;
  title?: string;
}

export function StatusBarItem({
  children,
  icon,
  tone = "default",
  testId,
  onClick,
  className,
  title,
}: Props) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      data-testid={testId}
      onClick={onClick}
      title={title}
      className={cn(
        "mv-statusbar-item flex h-full items-center gap-1 px-1.5 text-[11px] leading-none text-statusbar-fg",
        "transition-colors duration-100",
        onClick && "cursor-pointer hover:bg-statusbar-prominent",
        tone === "prominent" && "bg-statusbar-prominent",
        className
      )}
    >
      {icon && <span className="flex items-center">{icon}</span>}
      <span>{children}</span>
    </Tag>
  );
}
