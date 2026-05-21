import { type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  active?: boolean;
  badge?: number;
  testId?: string;
  onClick: () => void;
}

export function ActivityBarItem({
  icon: Icon,
  label,
  shortcut,
  active,
  badge,
  testId,
  onClick,
}: Props) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          data-active={active ? "true" : "false"}
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            "group relative flex h-11 w-full items-center justify-center",
            "text-activitybar-fg transition-colors duration-100 hover:text-activitybar-fg-active",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
            active && "text-activitybar-fg-active"
          )}
        >
          {active && (
            <span
              aria-hidden
              className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 bg-activitybar-indicator"
            />
          )}
          <Icon className="h-5 w-5" strokeWidth={1.6} />
          {badge && badge > 0 ? (
            <span className="absolute right-2 top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-none text-primary-foreground">
              {badge > 99 ? "99+" : badge}
            </span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="flex items-center gap-2">
        <span>{label}</span>
        {shortcut && (
          <span className="text-[10px] text-muted-foreground">{shortcut}</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
