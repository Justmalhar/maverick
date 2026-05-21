import { useState } from "react";
import { ChevronRight, Wrench } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

interface Props {
  toolCalls: Array<{ name: string; input?: string; output?: string }>;
}

export function ToolCallSummary({ toolCalls }: Props) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  if (toolCalls.length === 0) return null;

  return (
    <div
      data-testid="tool-call-summary"
      className="mt-1 rounded-sm border border-border bg-card text-xs"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-accent/10"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 text-muted-foreground transition-transform",
            open && "rotate-90"
          )}
        />
        <Wrench className="h-3 w-3 text-muted-foreground" />
        <span className="text-muted-foreground">
          {toolCalls.length} tool call{toolCalls.length === 1 ? "" : "s"}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={reduce ? undefined : { height: "auto", opacity: 1 }}
            exit={reduce ? undefined : { height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="overflow-hidden border-t border-border"
          >
            {toolCalls.map((tc, i) => (
              <li
                key={i}
                className="border-b border-border px-2 py-1 last:border-b-0"
              >
                <div className="text-foreground">{tc.name}</div>
                {tc.input && (
                  <pre className="mt-1 whitespace-pre-wrap text-[10px] text-muted-foreground">
                    {tc.input}
                  </pre>
                )}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
