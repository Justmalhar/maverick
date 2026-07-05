import { useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { ArrowDown, LoaderCircle, RotateCcw } from "lucide-react";
import { useAgentStore, emptySession, type TurnMeta } from "@/state/agent-store";
import { groupIntoTurns, aggregateTurnFileChanges, type Turn } from "@/lib/agent/turns";
import type { AgentChatMessage, AgentPart } from "@/lib/ipc";
import { UserMessage } from "./parts/UserMessage";
import { AssistantTurn } from "./parts/AssistantTurn";
import { TurnFooter } from "./parts/TurnFooter";
import { ChatMarkdown } from "./ChatMarkdown";

interface Props {
  sessionId: string;
  onOpenFile?: (path: string) => void;
  userActions?: (message: { id: string; text: string }) => React.ReactNode;
  onRetry?: (turn: { userParts: AgentPart[] }) => void;
}

function answerTextFor(messages: AgentChatMessage[]): string {
  const last = messages.at(-1);
  if (!last) return "";
  return last.parts.filter((p) => p.type === "text").map((p) => (p.type === "text" ? p.text : "")).join("\n");
}

function TurnView({
  turn,
  streaming,
  onOpenFile,
  userActions,
  onRetry,
  turnMeta,
}: { turn: Turn; streaming: boolean; turnMeta?: TurnMeta } & Pick<Props, "onOpenFile" | "userActions" | "onRetry">) {
  const hasError = turn.system.length > 0;
  return (
    <div className="flex flex-col gap-3 px-4 py-2">
      {turn.user && (
        <UserMessage
          message={turn.user}
          actions={userActions?.({
            id: turn.user.id,
            text: turn.user.parts.filter((p) => p.type === "text").map((p) => (p.type === "text" ? p.text : "")).join("\n"),
          })}
        />
      )}
      <AssistantTurn messages={turn.assistant} streaming={streaming} onOpenFile={onOpenFile} />
      {!streaming && turn.assistant.length > 0 && (
        <TurnFooter
          turnId={turn.turnId}
          meta={turnMeta}
          answerText={answerTextFor(turn.assistant)}
          fileChanges={aggregateTurnFileChanges(turn.assistant)}
          onOpenFile={onOpenFile}
        />
      )}
      {turn.system.map((m) => (
        <div key={m.id} className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive" data-testid="agent-error-row">
          {m.parts.map((p, i) => (p.type === "text" ? <ChatMarkdown key={i} text={p.text} /> : null))}
        </div>
      ))}
      {hasError && turn.user && onRetry && (
        <button
          type="button"
          aria-label="Retry message"
          onClick={() => onRetry({ userParts: turn.user!.parts })}
          className="flex w-fit items-center gap-1.5 self-start rounded-sm px-1.5 py-0.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" />
          Retry
        </button>
      )}
    </div>
  );
}

export function Transcript({ sessionId, onOpenFile, userActions, onRetry }: Props) {
  const slice = useAgentStore((s) => s.sessions[sessionId]) ?? emptySession();
  const turns = useMemo(() => groupIntoTurns(slice.messages), [slice.messages]);
  const virtuoso = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  const working = slice.status === "working";

  return (
    <div className="mv-transcript relative min-h-0 flex-1" data-testid="agent-transcript">
      <Virtuoso
        ref={virtuoso}
        data={turns}
        computeItemKey={(_, t) => t.turnId}
        followOutput={(isAtBottom) => (isAtBottom ? "smooth" : false)}
        atBottomStateChange={setAtBottom}
        initialTopMostItemIndex={Math.max(0, turns.length - 1)}
        initialItemCount={turns.length}
        itemContent={(index, turn) => (
          <TurnView
            turn={turn}
            streaming={working && index === turns.length - 1}
            onOpenFile={onOpenFile}
            userActions={userActions}
            onRetry={onRetry}
            turnMeta={slice.turnMeta[turn.turnId]}
          />
        )}
        components={{
          Footer: () =>
            working ? (
              <div className="flex items-center gap-2 px-4 py-3 text-[12px] text-muted-foreground" data-testid="agent-working">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                Working…
              </div>
            ) : (
              <div className="h-2" />
            ),
        }}
      />
      {!atBottom && (
        <button
          type="button"
          onClick={() => virtuoso.current?.scrollToIndex({ index: turns.length - 1, behavior: "smooth", align: "end" })}
          data-testid="scroll-to-bottom"
          className="absolute bottom-3 left-1/2 z-overlay flex -translate-x-1/2 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground shadow-md transition-colors duration-100 hover:text-foreground"
        >
          <ArrowDown className="h-3 w-3" />
          Scroll to bottom
        </button>
      )}
    </div>
  );
}
