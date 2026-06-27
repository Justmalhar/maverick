import type { Workspace } from "@/lib/ipc";
import { useWorkbench } from "@/state/store";
import { useShallow } from "zustand/react/shallow";
import { TerminalView } from "./terminal/TerminalView";
import { cn } from "@/lib/utils";

interface Props { workspace: Workspace; active: boolean; }

// Keep-alive: never unmount on workspace switch — toggle visibility only. Every
// terminal PTY survives. What does NOT survive an inactive switch is the
// expensive xterm renderer slot: an inactive editor passes visible=false so its
// leaves release their pooled slots back to the bounded renderer pool. RSS then
// scales with the pool size (~6), not the number of open terminals (CLAUDE.md
// 200MB budget), while the PTY/session lives on (CLAUDE.md rule 6).
export function WorkspaceEditor({ workspace, active }: Props) {
  const workspaceId = workspace.id;
  // useShallow performs shallow array/object comparison so selectors returning new
  // arrays each call don't cause infinite re-render loops (zustand uses Object.is).
  const groups = useWorkbench(useShallow((s) => s.terminalGroups.filter((g) => g.workspaceId === workspaceId)));
  const activeGroupId = useWorkbench((s) => s.activeGroupByWorkspace[workspaceId]) ?? workspaceId;
  return (
    <div
      data-testid={`workspace-editor-${workspace.id}`}
      data-active={active ? "true" : "false"}
      className={cn("mv-workspace-editor absolute inset-0 flex flex-col bg-editor", !active && "keep-alive-hidden content-visibility-auto")}
      aria-hidden={!active}
    >
      {groups.map((g) => {
        const groupActive = active && g.id === activeGroupId;
        return (
          <div
            key={g.id}
            data-testid={`terminal-group-${g.id}`}
            aria-hidden={!groupActive}
            className={cn("absolute inset-0", !groupActive && "keep-alive-hidden content-visibility-auto")}
          >
            <TerminalView workspace={workspace} groupId={g.id} visible={groupActive} />
          </div>
        );
      })}
    </div>
  );
}
