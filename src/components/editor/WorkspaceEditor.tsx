import { useWorkbench, selectEditorMode } from "@/state/store";
import type { Workspace } from "@/lib/ipc";
import { AgentView } from "./agent/AgentView";
import { TerminalView } from "./terminal/TerminalView";
import { cn } from "@/lib/utils";

interface Props {
  workspace: Workspace;
  active: boolean;
}

// Keep-alive: never unmount on workspace switch — toggle visibility only.
// This preserves both the agent view's local state and the terminal PTYs.
export function WorkspaceEditor({ workspace, active }: Props) {
  const mode = useWorkbench(selectEditorMode(workspace.id));

  return (
    <div
      data-testid={`workspace-editor-${workspace.id}`}
      data-active={active ? "true" : "false"}
      className={cn(
        "mv-workspace-editor absolute inset-0 flex flex-col bg-editor",
        !active && "keep-alive-hidden content-visibility-auto"
      )}
      aria-hidden={!active}
    >
      <div className="absolute inset-0" hidden={mode !== "agent"}>
        <AgentView workspace={workspace} />
      </div>
      <div className="absolute inset-0" hidden={mode !== "terminal"}>
        <TerminalView workspace={workspace} />
      </div>
    </div>
  );
}
