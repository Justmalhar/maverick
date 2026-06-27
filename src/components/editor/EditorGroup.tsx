import { lazy, Suspense, useMemo } from "react";
import { useWorkbench, computeLiveWorkspaceIds, computeLiveFileTabIds, type SystemTabId } from "@/state/store";
import { useSettings } from "@/lib/stores/settings";
import { EditorTabs } from "./EditorTabs";
import { EditorBreadcrumb } from "./EditorBreadcrumb";
import { WorkspaceEditor } from "./WorkspaceEditor";
import { EmptyEditor } from "./EmptyEditor";
import { DashboardView } from "@/components/primarysidebar/DashboardView";
import { cn } from "@/lib/utils";

const FileTabPane = lazy(() => import("@/components/viewers/FileTabPane"));

const UsagePanel = lazy(() => import("@/panels/usage/UsagePanel"));
const BrowserPanel = lazy(() => import("@/panels/browser/BrowserPanel"));
const KanbanBoard = lazy(() => import("@/panels/kanban/KanbanBoard"));
const MCPsPanel = lazy(() => import("@/panels/mcps/MCPsPanel"));
const SkillsPanel = lazy(() => import("@/panels/skills/SkillsPanel"));
const SkillEditorPanel = lazy(() => import("@/panels/skills/SkillEditorPanel"));
const GitPanel = lazy(() => import("@/panels/git/GitPanel"));

// The browser is keep-alive mounted separately (see below) so its page/URL/
// history survive a tab switch — switching to it here would unmount it.
function SystemTabContent({ id }: { id: Exclude<SystemTabId, "browser"> }) {
  switch (id) {
    case "dashboard":
      return <DashboardView />;
    case "usage":
      return <UsagePanel />;
    case "kanban":
      return <KanbanBoard />;
    case "mcps":
      return <MCPsPanel />;
    case "skills":
      return <SkillsPanel />;
    case "skill-editor":
      return <SkillEditorPanel />;
    case "git":
      return <GitPanel />;
  }
}

export function EditorGroup() {
  const workspaces = useWorkbench((s) => s.workspaces);
  const activeId = useWorkbench((s) => s.activeWorkspaceId);
  const accessOrder = useWorkbench((s) => s.workspaceAccessOrder);
  const systemTabs = useWorkbench((s) => s.systemTabs);
  const activeSystemTab = useWorkbench((s) => s.activeSystemTab);
  const [lruLimit] = useSettings("advanced.lruLimit", 8);

  const fileTabs = useWorkbench((s) => s.fileTabs);
  const activeFileTabId = useWorkbench((s) => s.activeFileTabId);
  const fileTabAccessOrder = useWorkbench((s) => s.fileTabAccessOrder);

  const liveFileTabIds = useMemo(
    () => computeLiveFileTabIds(fileTabs, fileTabAccessOrder, activeFileTabId, lruLimit),
    [fileTabs, fileTabAccessOrder, activeFileTabId, lruLimit]
  );

  const hasAnyTabs = workspaces.length > 0 || systemTabs.length > 0 || fileTabs.length > 0;
  const showEmpty = !hasAnyTabs;
  const showSystemTab = activeSystemTab && systemTabs.includes(activeSystemTab);
  const showFileTab = !!activeFileTabId && fileTabs.some((t) => t.id === activeFileTabId);
  // Keep the browser mounted for the lifetime of its tab. It is only torn down
  // when its tab is closed, so a page survives switching to any other tab.
  const browserOpen = systemTabs.includes("browser");
  const browserVisible = Boolean(showSystemTab) && activeSystemTab === "browser";

  const liveIds = useMemo(
    () => computeLiveWorkspaceIds(workspaces, accessOrder, activeId, lruLimit),
    [workspaces, accessOrder, activeId, lruLimit]
  );

  return (
    <div
      data-testid="editor-group"
      className="mv-editorgroup flex h-full w-full flex-col bg-editor"
    >
      {hasAnyTabs && <EditorBreadcrumb />}
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
              active={!showSystemTab && !showFileTab && ws.id === activeId}
            />
          ))}

        {/* Browser: keep-alive mounted while its tab exists; hidden (not
            unmounted) when another tab is active so the page survives. */}
        {browserOpen && (
          <Suspense fallback={null}>
            <div
              className="absolute inset-0 overflow-hidden bg-editor"
              style={{ display: browserVisible ? undefined : "none" }}
              aria-hidden={!browserVisible}
            >
              <BrowserPanel visible={browserVisible} />
            </div>
          </Suspense>
        )}

        {/* File tabs: LRU suspended (unmounted) when outside the window.
            Clean tabs remount from disk on re-focus — safe because they
            cannot have unsaved changes (dirty tabs are always kept live).
            LRU suspension bounds Monaco editor instance count and RSS. */}
        {fileTabs
          .filter((tab) => liveFileTabIds.has(tab.id))
          .map((tab) => {
            const active = showFileTab && tab.id === activeFileTabId;
            return (
              <div
                key={tab.id}
                data-testid={`file-tab-content-${tab.id}`}
                aria-hidden={!active}
                className={cn(
                  "absolute inset-0 bg-editor",
                  !active && "keep-alive-hidden content-visibility-auto"
                )}
              >
                <Suspense fallback={null}>
                  <FileTabPane tab={tab} active={active} />
                </Suspense>
              </div>
            );
          })}

        {/* Other system tabs: lazy-loaded, mounted only when active */}
        {showSystemTab && activeSystemTab && activeSystemTab !== "browser" && (
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
