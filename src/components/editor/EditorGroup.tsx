import { lazy, Suspense, useMemo } from "react";
import { useWorkbench, computeLiveWorkspaceIds, type SystemTabId } from "@/state/store";
import { useSettings } from "@/lib/stores/settings";
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
  const accessOrder = useWorkbench((s) => s.workspaceAccessOrder);
  const systemTabs = useWorkbench((s) => s.systemTabs);
  const activeSystemTab = useWorkbench((s) => s.activeSystemTab);
  const [lruLimit] = useSettings("advanced.lruLimit", 8);

  const hasAnyTabs = workspaces.length > 0 || systemTabs.length > 0;
  const showEmpty = !hasAnyTabs;
  const showSystemTab = activeSystemTab && systemTabs.includes(activeSystemTab);

  const liveIds = useMemo(
    () => computeLiveWorkspaceIds(workspaces, accessOrder, activeId, lruLimit),
    [workspaces, accessOrder, activeId, lruLimit]
  );

  return (
    <div
      data-testid="editor-group"
      className="mv-editorgroup flex h-full w-full flex-col bg-editor"
    >
      {hasAnyTabs && <EditorTabs />}
      <div className="relative flex-1 overflow-hidden">
        {showEmpty && <EmptyEditor />}

        {/* Workspaces: keep-alive mounted within the LRU window, hidden when
            not active. Workspaces outside the window are suspended (DOM
            destroyed) — their sidecar PTYs persist and reconnect on re-focus. */}
        {workspaces
          .filter((ws) => liveIds.has(ws.id))
          .map((ws) => (
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
