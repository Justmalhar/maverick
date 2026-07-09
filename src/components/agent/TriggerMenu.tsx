import { useEffect, useMemo, useState } from "react";
import { FileText, SlashSquare } from "lucide-react";
import { fileSearch } from "@/lib/tauri";
import type { AgentCapabilities } from "@/lib/ipc";
import { applyTrigger, detectTrigger } from "@/lib/agent/trigger";

interface Props {
  worktreePath: string;
  caps: Pick<AgentCapabilities, "slashCommands"> | null;
  draft: string;
  caret: number;
  onPick: (next: { text: string; caret: number }) => void;
}

interface Item { key: string; label: string; description?: string; insert: string; icon: "file" | "slash" }

export function TriggerMenu({ worktreePath, caps, draft, caret, onPick }: Props) {
  const trigger = useMemo(() => detectTrigger(draft, caret), [draft, caret]);
  const [fileHits, setFileHits] = useState<string[]>([]);

  useEffect(() => {
    if (!trigger || trigger.kind !== "mention" || trigger.query.length < 1) {
      setFileHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      fileSearch(worktreePath, trigger.query, 8)
        .then((res) => { if (!cancelled) setFileHits(res.hits.map((h) => h.rel)); })
        .catch(() => { if (!cancelled) setFileHits([]); });
    }, 120);
    return () => { cancelled = true; clearTimeout(t); };
  }, [trigger?.kind, trigger?.query, worktreePath]);

  if (!trigger) return null;

  const items: Item[] =
    trigger.kind === "slash"
      ? (caps?.slashCommands ?? [])
          .filter((c) => c.name.slice(1).toLowerCase().startsWith(trigger.query.toLowerCase()))
          .map((c) => ({ key: c.name, label: c.name, description: c.description, insert: c.name, icon: "slash" as const }))
      : fileHits.map((p) => ({ key: p, label: p, insert: `@${p}`, icon: "file" as const }));

  if (items.length === 0) return null;

  return (
    <div
      data-testid="trigger-menu"
      className="mv-triggermenu absolute bottom-full left-0 z-overlay mb-1 max-h-56 w-full max-w-md overflow-y-auto rounded-md border border-border bg-card p-1 shadow-md"
      role="listbox"
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="option"
          aria-selected={false}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(applyTrigger(draft, trigger, item.insert));
          }}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] text-foreground hover:bg-muted"
        >
          {item.icon === "slash" ? <SlashSquare className="h-3.5 w-3.5 shrink-0 opacity-70" /> : <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />}
          <span className="truncate font-mono">{item.label}</span>
          {item.description && <span className="ml-auto truncate text-[11px] text-muted-foreground">{item.description}</span>}
        </button>
      ))}
    </div>
  );
}
