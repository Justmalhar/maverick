import type { AgentChatMessage } from "@/lib/ipc";
import { ActivitySection } from "./ActivitySection";
import { ChatMarkdown } from "../ChatMarkdown";

function isFinalAnswer(m: AgentChatMessage): boolean {
  return m.parts.some((p) => p.type === "text" && p.text.trim()) && !m.parts.some((p) => p.type === "tool-call");
}

export function AssistantTurn({
  messages,
  streaming,
  onOpenFile,
}: {
  messages: AgentChatMessage[];
  streaming: boolean;
  onOpenFile?: (path: string) => void;
}) {
  const last = messages.at(-1);
  const finalAnswer = !streaming && last && isFinalAnswer(last) ? last : null;
  const rest = finalAnswer ? messages.slice(0, -1) : messages;
  // The final answer commonly arrives as one message carrying [thinking, text];
  // only its text is promoted below, so its remaining parts must still reach
  // the activity area or they would never render at all.
  const finalExtras = finalAnswer ? finalAnswer.parts.filter((p) => p.type !== "text") : [];
  const activity = finalAnswer && finalExtras.length > 0 ? [...rest, { ...finalAnswer, parts: finalExtras }] : rest;
  return (
    <div className="mv-assistantturn flex flex-col gap-2" data-testid="assistant-turn">
      <ActivitySection messages={activity} streaming={streaming} onOpenFile={onOpenFile} />
      {finalAnswer &&
        finalAnswer.parts.map((p, i) => (p.type === "text" && p.text.trim() ? <ChatMarkdown key={i} text={p.text} /> : null))}
    </div>
  );
}
