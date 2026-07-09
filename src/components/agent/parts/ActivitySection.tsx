import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentChatMessage, AgentPart } from "@/lib/ipc";
import { ThinkingRow } from "./ThinkingRow";
import { ToolCallRow } from "./ToolCallRow";
import { ChatMarkdown } from "../ChatMarkdown";

export function countActivity(messages: AgentChatMessage[]): { tools: number; texts: number } {
  let tools = 0;
  let texts = 0;
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type === "tool-call") tools += 1;
      if (p.type === "text" && p.text.trim()) texts += 1;
    }
  }
  return { tools, texts };
}

function PartView({ part, onOpenFile }: { part: AgentPart; onOpenFile?: (path: string) => void }) {
  switch (part.type) {
    case "text":
      return part.text.trim() ? <ChatMarkdown text={part.text} /> : null;
    case "thinking":
      return <ThinkingRow part={part} />;
    case "tool-call":
      return <ToolCallRow part={part} onOpenFile={onOpenFile} />;
    case "attachment":
      return null;
  }
}

export function ActivitySection({
  messages,
  streaming,
  onOpenFile,
}: {
  messages: AgentChatMessage[];
  streaming: boolean;
  onOpenFile?: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { tools, texts } = countActivity(messages);
  if (messages.length === 0) return null;
  const expanded = open || streaming;
  return (
    <div className="mv-activitysection flex flex-col gap-1">
      {!streaming && tools > 0 && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={expanded}
          data-testid="activity-toggle"
          className="flex items-center gap-1.5 self-start rounded-sm px-1 py-0.5 text-[12px] text-muted-foreground hover:bg-muted"
        >
          <ChevronRight className={cn("h-3 w-3 transition-transform duration-100", expanded && "rotate-90")} />
          {tools} tool {tools === 1 ? "call" : "calls"}, {texts} {texts === 1 ? "message" : "messages"}
        </button>
      )}
      {(expanded || tools === 0) && (
        <div className="flex flex-col gap-2">
          {messages.map((m) => (
            <div key={m.id} className="flex flex-col gap-2">
              {m.parts.map((p, i) => (
                <PartView key={`${m.id}-${i}`} part={p} onOpenFile={onOpenFile} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
