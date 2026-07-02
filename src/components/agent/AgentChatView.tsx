import type { Workspace } from "@/lib/ipc";

interface Props {
  workspace: Workspace;
  visible: boolean;
}

export function AgentChatView({ workspace }: Props) {
  return (
    <div
      data-testid={`agent-chat-${workspace.id}`}
      className="mv-agentchat flex h-full items-center justify-center text-sm text-muted-foreground"
    >
      Agent chat — coming online in a later task
    </div>
  );
}
