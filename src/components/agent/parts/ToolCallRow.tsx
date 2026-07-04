import { useState } from "react";
import { ChevronRight, CircleAlert, LoaderCircle, Terminal, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentPart } from "@/lib/ipc";
import { FileChangeChip } from "./FileChangeChip";

const TOOL_ICONS: Record<string, typeof Wrench> = { Bash: Terminal };

export function ToolCallRow({
  part,
  onOpenFile,
}: {
  part: Extract<AgentPart, { type: "tool-call" }>;
  onOpenFile?: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICONS[part.toolName] ?? Wrench;
  return (
    <div className="mv-toolcallrow text-[12px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-muted-foreground hover:bg-muted"
      >
        {part.status === "running" ? (
          <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : part.status === "error" ? (
          <CircleAlert className="h-3.5 w-3.5 shrink-0 text-destructive" />
        ) : (
          <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
        )}
        <span className="truncate text-foreground">{part.title}</span>
        {part.detail && (
          <code className="truncate rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11px]">{part.detail}</code>
        )}
        <ChevronRight className={cn("ml-auto h-3 w-3 shrink-0 transition-transform duration-100", open && "rotate-90")} />
      </button>
      {part.fileChanges && part.fileChanges.length > 0 && (
        <div className="flex flex-wrap gap-1.5 py-1 pl-6">
          {part.fileChanges.map((c) => (
            <FileChangeChip key={c.path} change={c} onOpen={onOpenFile} />
          ))}
        </div>
      )}
      {open && part.output && (
        <pre className="ml-6 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted p-2 font-mono text-[11px] text-muted-foreground">
          {part.output}
        </pre>
      )}
    </div>
  );
}
