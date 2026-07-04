import { useCallback, useEffect, useRef, useState } from "react";
import type { Workspace } from "@/lib/ipc";
import { hydrateAgentSession } from "@/lib/agent/agent-events";
import { useWorkbench } from "@/state/store";
import { Transcript } from "./Transcript";
import { Composer } from "./Composer";
import { RewindMenu } from "./RewindMenu";

interface Props { workspace: Workspace; visible: boolean; }

export function AgentChatView({ workspace, visible }: Props) {
  const hydratedRef = useRef(false);
  const [restoredDraft, setRestoredDraft] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || hydratedRef.current) return;
    hydratedRef.current = true;
    hydrateAgentSession(workspace.id, workspace.sessionId).catch((e) => {
      hydratedRef.current = false;
      console.error("[agent] hydrate failed", e);
    });
  }, [visible, workspace.id, workspace.sessionId]);

  const onRewound = useCallback(
    (messageText: string) => {
      hydrateAgentSession(workspace.id, workspace.sessionId).catch((e) => console.error("[agent] rehydrate after rewind failed", e));
      setRestoredDraft(messageText);
    },
    [workspace.id, workspace.sessionId]
  );

  const openFile = useCallback(
    (path: string) => {
      useWorkbench.getState().openFileTab({ kind: "file", path, worktreePath: workspace.worktreePath, preview: true });
    },
    [workspace.worktreePath]
  );

  return (
    <div data-testid={`agent-chat-${workspace.id}`} className="mv-agentchat flex h-full flex-col bg-editor">
      <Transcript
        sessionId={workspace.sessionId}
        onOpenFile={openFile}
        userActions={({ id, text }) => (
          <RewindMenu sessionId={workspace.sessionId} messageId={id} messageText={text} onRewound={onRewound} />
        )}
      />
      <Composer
        workspace={workspace}
        restoredDraft={restoredDraft}
        onRestoredDraftConsumed={() => setRestoredDraft(null)}
      />
    </div>
  );
}
