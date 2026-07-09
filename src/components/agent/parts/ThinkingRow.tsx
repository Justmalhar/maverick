import { useState } from "react";
import { Brain, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentPart } from "@/lib/ipc";

export function ThinkingRow({ part }: { part: Extract<AgentPart, { type: "thinking" }> }) {
  const [open, setOpen] = useState(false);
  const summary = part.summary.trim();
  if (!summary) return null;
  const firstLine = summary.split("\n")[0];
  return (
    <div className="mv-thinkingrow text-[12px] text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-muted"
      >
        <Brain className="h-3.5 w-3.5 shrink-0 opacity-70" />
        <span className="font-medium">Thinking</span>
        <span className={cn("truncate rounded-sm bg-muted px-1.5 py-0.5", open && "hidden")}>{firstLine}</span>
        <ChevronRight className={cn("ml-auto h-3 w-3 shrink-0 transition-transform duration-100", open && "rotate-90")} />
      </button>
      {open && <div className="whitespace-pre-wrap px-6 py-1">{summary}</div>}
    </div>
  );
}
