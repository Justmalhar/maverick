import { useEffect, useRef } from "react";
import type { Workspace } from "@/lib/ipc";
import { hydrateAgentSession } from "@/lib/agent/agent-events";
import { Transcript } from "./Transcript";
import { Composer } from "./Composer";

interface Props { workspace: Workspace; visible: boolean; }

export function AgentChatView({ workspace, visible }: Props) {
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!visible || hydratedRef.current) return;
    hydratedRef.current = true;
    hydrateAgentSession(workspace.id, workspace.sessionId).catch((e) => {
      hydratedRef.current = false;
      console.error("[agent] hydrate failed", e);
    });
  }, [visible, workspace.id, workspace.sessionId]);

  return (
    <div data-testid={`agent-chat-${workspace.id}`} className="mv-agentchat flex h-full flex-col bg-editor">
      <Transcript sessionId={workspace.sessionId} />
      <Composer workspace={workspace} />
    </div>
  );
}
