import { useCallback, useEffect, useState } from "react";
import type { Message, Workspace } from "@/lib/ipc";
import { messagesList, messageAppend, ptyWrite } from "@/lib/tauri";
import { MessageList } from "./MessageList";
import { InputBar } from "./InputBar";

interface Props {
  workspace: Workspace;
}

export function AgentView({ workspace }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    if (!workspace.sessionId) return;
    let cancelled = false;
    messagesList(workspace.sessionId)
      .then((list) => {
        if (!cancelled) setMessages(list);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace.sessionId]);

  const onSubmit = useCallback(
    async (text: string) => {
      // Optimistically append the user message; the sidecar will persist it.
      const optimistic: Message = {
        id: `tmp-${Date.now()}`,
        sessionId: workspace.sessionId,
        role: "user",
        content: text,
        createdAt: Math.floor(Date.now() / 1000),
      };
      setMessages((prev) => [...prev, optimistic]);

      try {
        await messageAppend(workspace.sessionId, "user", text);
        const ptyId = workspace.id;
        if (ptyId) await ptyWrite(ptyId, `${text}\n`);
      } catch (e) {
        console.error("submit failed", e);
      }
    },
    [workspace]
  );

  return (
    <section
      data-testid={`agent-view-${workspace.id}`}
      className="mv-agent-view flex h-full w-full flex-col"
    >
      <div className="flex-1 overflow-hidden">
        <MessageList messages={messages} />
      </div>
      <InputBar workspace={workspace} onSubmit={onSubmit} />
    </section>
  );
}
