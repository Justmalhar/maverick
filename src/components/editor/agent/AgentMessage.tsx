import { motion, useReducedMotion } from "framer-motion";
import { Sparkles } from "lucide-react";
import type { Message } from "@/lib/ipc";
import { ToolCallSummary } from "./ToolCallSummary";

interface ToolCallShape {
  name: string;
  input?: string;
  output?: string;
}

function parseToolCalls(json?: string): ToolCallShape[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function AgentMessage({ message }: { message: Message }) {
  const reduce = useReducedMotion();
  const toolCalls = parseToolCalls(message.toolCallsJson);

  return (
    <motion.li
      data-testid={`message-agent-${message.id}`}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="flex gap-3"
    >
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-primary/15 text-primary">
        <Sparkles className="h-3.5 w-3.5" />
      </div>
      <div className="max-w-[80%] flex-1">
        <div className="whitespace-pre-wrap rounded-sm border border-border bg-card px-3 py-2 text-[13px] leading-relaxed text-foreground">
          {message.content}
        </div>
        <ToolCallSummary toolCalls={toolCalls} />
      </div>
    </motion.li>
  );
}
