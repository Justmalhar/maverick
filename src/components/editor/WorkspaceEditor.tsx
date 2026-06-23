import type { Workspace } from "@/lib/ipc";
import { TerminalView } from "./terminal/TerminalView";
import { useAutomationTriggers } from "@/hooks/useAutomationTriggers";
import { cn } from "@/lib/utils";

interface Props {
  workspace: Workspace;
  active: boolean;
}

// Keep-alive: never unmount on workspace switch — toggle visibility only. Every
// terminal PTY survives. What does NOT survive an inactive switch is the
// expensive xterm renderer slot: an inactive editor passes visible=false so its
// leaves release their pooled slots back to the bounded renderer pool. RSS then
// scales with the pool size (~6), not the number of open terminals (CLAUDE.md
// 200MB budget), while the PTY/session lives on (CLAUDE.md rule 6).
export function WorkspaceEditor({ workspace, active }: Props) {
  // Activate this workspace's automation triggers while its editor is mounted.
  useAutomationTriggers(workspace);
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
      <div className="absolute inset-0">
        <TerminalView workspace={workspace} visible={active} />
      </div>
    </div>
  );
}
