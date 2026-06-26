// Read-only, per-workspace view of a HEADLESS agent run. Streams the parsed
// stream-json output (assistant text, tool calls, result, stderr) from the
// agent-output store into a virtualized log — this is the "background" surface
// the user watches instead of an interactive terminal. No xterm (CLAUDE.md
// rule 4 / renderer-pool pressure): a virtualized list suffices for read-only text.
import { useEffect, useRef } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import { Bot, Loader2, Wrench, CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import { useWorkbench, selectContextWorkspace } from "@/state/store";
import { useAgentOutput, type AgentLine, type AgentRun } from "@/lib/stores/agent-output";
import { cn } from "@/lib/utils";

const ROW_HEIGHT = 20;
const EMPTY: AgentRun = { lines: [], running: false };

const KIND_META: Record<AgentLine["kind"], { tone: string; Icon: typeof Wrench | null }> = {
  text: { tone: "text-foreground", Icon: null },
  tool: { tone: "text-info", Icon: Wrench },
  result: { tone: "text-success", Icon: CircleCheck },
  stderr: { tone: "text-warning", Icon: TriangleAlert },
};

export function AgentOutputView() {
  const active = useWorkbench(selectContextWorkspace);
  const runs = useAgentOutput((s) => s.runs);
  const run = active ? runs[active.id] ?? EMPTY : EMPTY;
  const lines = run.lines;
  const listRef = useRef<FixedSizeList<AgentLine[]>>(null);

  // Auto-scroll to the newest line as output streams in. Guarded so the
  // react-window test mock (no scrollToItem) is a no-op.
  useEffect(() => {
    if (lines.length > 0) listRef.current?.scrollToItem?.(lines.length - 1, "end");
  }, [lines.length]);

  if (!active) {
    return (
      <div
        data-testid="agent-output-empty"
        className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center"
      >
        <Bot className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
        <span className="text-[13px] text-foreground">No active workspace</span>
        <p className="max-w-xs text-xs text-muted-foreground">
          Start a task or workspace to run an agent in the background.
        </p>
      </div>
    );
  }

  return (
    <div className="mv-agentoutput flex h-full flex-col" data-testid="agent-output-view">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <Bot className="h-3.5 w-3.5 shrink-0 text-sidebar-fg" />
        <span className="font-medium text-foreground">Agent</span>
        {run.running ? (
          <span className="flex items-center gap-1 text-[10px] text-warning" data-testid="agent-output-running">
            <Loader2 className="h-3 w-3 animate-spin" /> running
          </span>
        ) : lines.length > 0 ? (
          <span className="flex items-center gap-1 text-[10px] text-success" data-testid="agent-output-done">
            <CircleCheck className="h-3 w-3" /> done
          </span>
        ) : null}
        {typeof run.costUsd === "number" && (
          <span className="ml-auto font-mono text-[10px] text-muted-foreground" data-testid="agent-output-cost">
            ${run.costUsd.toFixed(3)}
          </span>
        )}
      </div>

      {lines.length === 0 ? (
        <div
          data-testid="agent-output-idle"
          className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground"
        >
          No agent output yet.
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <FixedSizeList<AgentLine[]>
            ref={listRef}
            height={Math.max(ROW_HEIGHT, lines.length * ROW_HEIGHT)}
            width="100%"
            itemCount={lines.length}
            itemSize={ROW_HEIGHT}
            itemData={lines}
            className="h-full"
          >
            {AgentRow}
          </FixedSizeList>
        </div>
      )}
    </div>
  );
}

function AgentRow({ index, style, data }: ListChildComponentProps<AgentLine[]>) {
  const line = data[index];
  const meta = KIND_META[line.kind];
  const Icon = line.kind === "result" && line.isError ? CircleX : meta.Icon;
  const tone = line.kind === "result" && line.isError ? "text-destructive" : meta.tone;
  return (
    <div
      style={style}
      data-testid={`agent-line-${line.kind}`}
      className="flex items-center gap-1.5 px-3 font-mono text-[11px] leading-5"
      title={line.text}
    >
      {Icon && <Icon className={cn("h-3 w-3 shrink-0", tone)} />}
      <span className={cn("truncate", tone)}>{line.text}</span>
    </div>
  );
}
