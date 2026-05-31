import { motion, useReducedMotion } from "framer-motion";
import { StatusDot, type StatusDotProps } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";
import type { AgentStatus } from "@/hooks/useAgentStatus";

interface PillMeta {
  label: string;
  variant: NonNullable<StatusDotProps["variant"]>;
}

const STATUS_META: Record<AgentStatus, PillMeta> = {
  idle: { label: "Idle", variant: "idle" },
  working: { label: "Working", variant: "running" },
  attention: { label: "Attention", variant: "warning" },
  done: { label: "Done", variant: "active" },
  error: { label: "Error", variant: "error" },
};

interface Props {
  status: AgentStatus;
  /** Render only the dot (tab context) instead of dot + label (StatusBar). */
  compact?: boolean;
  className?: string;
}

/**
 * Tokenized per-workspace agent-status indicator: a StatusDot plus an optional
 * label. The dot key changes per status so Framer Motion replays a small fade on
 * each transition; `prefers-reduced-motion` disables it.
 */
export function AgentStatusPill({ status, compact = false, className }: Props) {
  const reduce = useReducedMotion();
  const meta = STATUS_META[status];

  return (
    <span
      data-testid="agent-status-pill"
      data-status={status}
      title={`Agent: ${meta.label}`}
      className={cn("inline-flex items-center gap-1 leading-none", className)}
    >
      <motion.span
        key={status}
        initial={reduce ? false : { opacity: 0, scale: 0.6 }}
        animate={reduce ? undefined : { opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
        className="inline-flex"
      >
        <StatusDot variant={meta.variant} size="sm" />
      </motion.span>
      {!compact && (
        <span className="text-[11px] text-muted-foreground">{meta.label}</span>
      )}
    </span>
  );
}
