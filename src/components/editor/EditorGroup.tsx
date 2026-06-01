import { lazy, Suspense, useMemo } from "react";
import { useWorkbench, computeLiveWorkspaceIds, type SystemTabId } from "@/state/store";
import { useSettings } from "@/lib/stores/settings";
import { EditorTabs } from "./EditorTabs";
import { WorkspaceEditor } from "./WorkspaceEditor";
import { EmptyEditor } from "./EmptyEditor";
import { TerminalPane } from "./terminal/TerminalPane";
import { cn } from "@/lib/utils";

const UsagePanel = lazy(() => import("@/panels/usage/UsagePanel"));
const BrowserPanel = lazy(() => import("@/panels/browser/BrowserPanel"));
const KanbanBoard = lazy(() => import("@/panels/kanban/KanbanBoard"));
const AutomationsPanel = lazy(() => import("@/panels/automations/AutomationsPanel"));
const MCPsPanel = lazy(() => import("@/panels/mcps/MCPsPanel"));

// The browser is keep-alive mounted separately (see below) so its page/URL/
// history survive a tab switch — switching to it here would unmount it.
function SystemTabContent({ id }: { id: Exclude<SystemTabId, "browser"> }) {
  switch (id) {
    case "dashboard":
      return <UsagePanel />;
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
  const terminalTabs = useWorkbench((s) => s.terminalTabs);
  const activeTerminalTabId = useWorkbench((s) => s.activeTerminalTabId);
  const setActiveTerminalTab = useWorkbench((s) => s.setActiveTerminalTab);

  const hasAnyTabs = workspaces.length > 0 || systemTabs.length > 0 || terminalTabs.length > 0;
  const showEmpty = !hasAnyTabs;
  const showSystemTab = activeSystemTab && systemTabs.includes(activeSystemTab);
  const showTerminalTab =
    !!activeTerminalTabId && terminalTabs.some((t) => t.id === activeTerminalTabId);
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
              active={!showSystemTab && !showTerminalTab && ws.id === activeId}
            />
          ))}

        {/* Standalone terminal tabs: keep-alive mounted, hidden (not unmounted)
            when not active so the PTY and scrollback survive a tab switch. */}
        {terminalTabs.map((tab) => {
          const active = showTerminalTab && tab.id === activeTerminalTabId;
          return (
            <div
              key={tab.id}
              data-testid={`terminal-tab-content-${tab.id}`}
              aria-hidden={!active}
              className={cn(
                "absolute inset-0 bg-background",
                !active && "keep-alive-hidden content-visibility-auto"
              )}
            >
              {tab.ptyId ? (
                <TerminalPane
                  ptyId={tab.ptyId}
                  paneId={tab.id}
                  isFocused={active}
                  onFocus={() => setActiveTerminalTab(tab.id)}
                />
              ) : (
                <div
                  data-testid={`terminal-tab-starting-${tab.id}`}
                  className="flex h-full items-center justify-center text-xs text-muted-foreground"
                >
                  Starting terminal…
                </div>
              )}
            </div>
          );
        })}

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
