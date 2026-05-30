import { useWorkbench, selectEditorMode } from "@/state/store";
import type { Workspace } from "@/lib/ipc";
import { AgentTerminal } from "./agent/AgentTerminal";
import { TerminalView } from "./terminal/TerminalView";
import { cn } from "@/lib/utils";

interface Props {
  workspace: Workspace;
  active: boolean;
}

// Keep-alive: never unmount on workspace switch — toggle visibility only. The
// agent view's local state and every terminal PTY survive. What does NOT
// survive an inactive switch is the expensive xterm renderer slot: an inactive
// (or non-terminal-mode) editor passes visible=false so its leaves release
// their pooled slots back to the bounded renderer pool. RSS then scales with
// the pool size (~6), not the number of open terminals (CLAUDE.md 200MB
// budget), while the PTY/session lives on (CLAUDE.md rule 6).
export function WorkspaceEditor({ workspace, active }: Props) {
  const mode = useWorkbench(selectEditorMode(workspace.id));
  const terminalVisible = active && mode === "terminal";

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
        <AgentTerminal workspace={workspace} />
      </div>
      <div className="absolute inset-0" hidden={mode !== "terminal"}>
        <TerminalView workspace={workspace} visible={terminalVisible} />
      </div>
    </div>
  );
}
