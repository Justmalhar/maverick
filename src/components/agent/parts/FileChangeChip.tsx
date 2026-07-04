import { FileText } from "lucide-react";
import type { AgentFileChange } from "@/lib/ipc";

export function FileChangeChip({ change, onOpen }: { change: AgentFileChange; onOpen?: (path: string) => void }) {
  const name = change.path.split("/").pop() ?? change.path;
  return (
    <button
      type="button"
      title={change.path}
      onClick={() => onOpen?.(change.path)}
      data-testid={`file-chip-${change.path}`}
      className="mv-filechangechip inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 font-mono text-[11px] text-foreground transition-colors duration-100 hover:bg-muted"
    >
      <FileText className="h-3 w-3 shrink-0 opacity-70" />
      <span className="max-w-[220px] truncate">{name}</span>
      {change.additions > 0 && <span className="text-success">+{change.additions}</span>}
      {change.deletions > 0 && <span className="text-destructive">-{change.deletions}</span>}
    </button>
  );
}
