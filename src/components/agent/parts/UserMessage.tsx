import { Paperclip } from "lucide-react";
import type { AgentChatMessage, AgentPart } from "@/lib/ipc";

function isText(p: AgentPart): p is Extract<AgentPart, { type: "text" }> {
  return p.type === "text";
}

function isAttachment(p: AgentPart): p is Extract<AgentPart, { type: "attachment" }> {
  return p.type === "attachment";
}

export function UserMessage({ message, actions }: { message: AgentChatMessage; actions?: React.ReactNode }) {
  const text = message.parts
    .filter(isText)
    .map((p) => p.text)
    .join("\n\n");
  const attachments = message.parts.filter(isAttachment);
  return (
    <div className="mv-usermessage group flex justify-end" data-testid={`user-message-${message.id}`}>
      <div className="flex max-w-[80%] flex-col items-end gap-1">
        {attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {attachments.map((a) => (
              <span
                key={a.path}
                title={a.path}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
              >
                <Paperclip className="h-3 w-3" />
                <span className="max-w-[200px] truncate">{a.name}</span>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-start gap-1">
          <span className="opacity-0 transition-opacity duration-100 group-hover:opacity-100">{actions}</span>
          <div className="whitespace-pre-wrap rounded-lg bg-muted px-4 py-2.5 text-[13px] text-foreground">{text}</div>
        </div>
      </div>
    </div>
  );
}
