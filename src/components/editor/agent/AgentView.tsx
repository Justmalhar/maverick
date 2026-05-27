import { useCallback, useEffect, useRef, useState } from "react";
import type { Message, Workspace } from "@/lib/ipc";
import { messagesList, messageAppend, ptyWrite, instructionsResolve } from "@/lib/tauri";
import { recordUsageEstimate } from "@/hooks/useContextUsage";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import { MessageList } from "./MessageList";
import { InputBar } from "./InputBar";

interface Props {
  workspace: Workspace;
}

/** Prepend the resolved instruction files to the very first prompt of a session. */
async function buildPreamble(worktreePath: string): Promise<string> {
  try {
    const instr = await instructionsResolve(worktreePath);
    const parts = [instr.global, instr.project].filter(Boolean);
    const generalPref = useProjectSettingsStore.getState().data?.preferences?.general?.trim();
    if (generalPref) {
      parts.push(`--- Project Preferences ---\n${generalPref}`);
    }
    return parts.join("\n\n");
  } catch {
    return "";
  }
}

export function AgentView({ workspace }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  // A fresh session (no persisted history) gets the instruction preamble on its
  // first prompt only; the ref guards against double-injection within a mount.
  const freshSessionRef = useRef(false);
  const preambleSentRef = useRef(false);
  const messagesRef = useRef<Message[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!workspace.sessionId) return;
    let cancelled = false;
    preambleSentRef.current = false;
    messagesList(workspace.sessionId)
      .then((list) => {
        if (cancelled) return;
        setMessages(list);
        freshSessionRef.current = list.length === 0;
        void recordUsageEstimate(workspace.sessionId, list, workspace.agentBackend).catch(
          () => {}
        );
      })
      .catch(() => {
        if (cancelled) return;
        setMessages([]);
        freshSessionRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [workspace.sessionId, workspace.agentBackend]);

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
      const nextMessages = [...messagesRef.current, optimistic];
      setMessages(nextMessages);

      try {
        await messageAppend(workspace.sessionId, "user", text);
        void recordUsageEstimate(
          workspace.sessionId,
          nextMessages,
          workspace.agentBackend
        ).catch(() => {});
        const ptyId = workspace.id;
        let toSend = text;
        if (freshSessionRef.current && !preambleSentRef.current) {
          preambleSentRef.current = true;
          const preamble = await buildPreamble(workspace.worktreePath);
          if (preamble) toSend = `${preamble}\n\n${text}`;
        }
        if (ptyId) await ptyWrite(ptyId, `${toSend}\n`);
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
