import { useEffect, useRef } from "react";
import { MessageSquare } from "lucide-react";
import type { Message } from "@/lib/ipc";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UserMessage } from "./UserMessage";
import { AgentMessage } from "./AgentMessage";

interface Props {
  messages: Message[];
}

export function MessageList({ messages }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <MessageSquare className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
        <span className="text-[13px] text-foreground">
          Start a conversation
        </span>
        <p className="max-w-xs text-xs text-muted-foreground">
          Send a prompt or invoke a skill to begin. The agent's response will
          stream here.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full" data-testid="message-list">
      <ul className="flex flex-col gap-4 px-6 py-4">
        {messages.map((m) =>
          m.role === "user" ? (
            <UserMessage key={m.id} message={m} />
          ) : (
            <AgentMessage key={m.id} message={m} />
          )
        )}
      </ul>
      <div ref={bottomRef} />
    </ScrollArea>
  );
}
