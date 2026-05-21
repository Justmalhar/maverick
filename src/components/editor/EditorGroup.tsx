import { lazy, Suspense } from "react";
import { useWorkbench, type SystemTabId } from "@/state/store";
import { EditorTabs } from "./EditorTabs";
import { WorkspaceEditor } from "./WorkspaceEditor";
import { EmptyEditor } from "./EmptyEditor";

const UsagePanel = lazy(() => import("@/panels/usage/UsagePanel"));
const BrowserPanel = lazy(() => import("@/panels/browser/BrowserPanel"));
const KanbanBoard = lazy(() => import("@/panels/kanban/KanbanBoard"));
const AutomationsPanel = lazy(() => import("@/panels/automations/AutomationsPanel"));
const MCPsPanel = lazy(() => import("@/panels/mcps/MCPsPanel"));

function SystemTabContent({ id }: { id: SystemTabId }) {
  switch (id) {
    case "dashboard":
      return <UsagePanel />;
    case "browser":
      return <BrowserPanel />;
    case "kanban":
      return <KanbanBoard />;
    case "automations":
      return <AutomationsPanel />;
    case "mcps":
      return <MCPsPanel />;
  }
}

export function EditorGroup() {
  const workspaces = useWorkbench((s) => s.workspaces);
  const activeId = useWorkbench((s) => s.activeWorkspaceId);
  const systemTabs = useWorkbench((s) => s.systemTabs);
  const activeSystemTab = useWorkbench((s) => s.activeSystemTab);

  const hasAnyTabs = workspaces.length > 0 || systemTabs.length > 0;
  const showEmpty = !hasAnyTabs;
  const showSystemTab = activeSystemTab && systemTabs.includes(activeSystemTab);

  return (
    <div
      data-testid="editor-group"
      className="mv-editorgroup flex h-full w-full flex-col bg-editor"
    >
      {hasAnyTabs && <EditorTabs />}
      <div className="relative flex-1 overflow-hidden">
        {showEmpty && <EmptyEditor />}

        {/* Workspaces: keep-alive mounted, hidden when not active */}
        {workspaces.map((ws) => (
          <WorkspaceEditor
            key={ws.id}
            workspace={ws}
            active={!showSystemTab && ws.id === activeId}
          />
        ))}

        {/* System tabs: lazy-loaded, mounted only when active */}
        {showSystemTab && (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading…
              </div>
            }
          >
            <div className="absolute inset-0 overflow-auto bg-editor">
              <SystemTabContent id={activeSystemTab} />
            </div>
          </Suspense>
        )}
      </div>
    </div>
  );
}
