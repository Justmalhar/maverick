import { FolderTree, GitBranch, KanbanSquare, Zap, Plug } from "lucide-react";
import { useWorkbench, type SystemTabId } from "@/state/store";
import type { ActivityView } from "@/lib/ipc";
import { ActivityBarItem } from "./ActivityBarItem";

// Top: Projects view. Below: document-style views opened as editor tabs.
// Bottom: settings only — account opened the same modal so it was redundant.
const VIEW_ITEMS: Array<{
  view: ActivityView;
  icon: typeof FolderTree;
  label: string;
  shortcut?: string;
}> = [
  { view: "projects", icon: FolderTree, label: "Projects", shortcut: "⌘⇧E" },
  { view: "git", icon: GitBranch, label: "Source Control", shortcut: "⌘⇧G" },
];

const TAB_ITEMS: Array<{
  tab: SystemTabId;
  icon: typeof KanbanSquare;
  label: string;
  shortcut?: string;
}> = [
  { tab: "kanban", icon: KanbanSquare, label: "Tasks", shortcut: "⌘⇧K" },
  { tab: "automations", icon: Zap, label: "Automations", shortcut: "⌘⇧A" },
  { tab: "mcps", icon: Plug, label: "MCP Servers" },
];

export function ActivityBar() {
  const activityView = useWorkbench((s) => s.layout.activityView);
  const primarySideBarVisible = useWorkbench((s) => s.layout.primarySideBarVisible);
  const setActivityView = useWorkbench((s) => s.setActivityView);
  const togglePrimarySideBar = useWorkbench((s) => s.togglePrimarySideBar);
  const openSystemTab = useWorkbench((s) => s.openSystemTab);
  const setActiveSystemTab = useWorkbench((s) => s.setActiveSystemTab);
  const activeSystemTab = useWorkbench((s) => s.activeSystemTab);
  const systemTabs = useWorkbench((s) => s.systemTabs);

  function onSelectView(view: ActivityView) {
    if (view === activityView && primarySideBarVisible) {
      togglePrimarySideBar();
      return;
    }
    setActivityView(view);
  }

  function onSelectTab(tab: SystemTabId) {
    if (systemTabs.includes(tab)) {
      setActiveSystemTab(tab);
    } else {
      openSystemTab(tab);
    }
  }

  return (
    <aside
      data-testid="activitybar"
      className="mv-activitybar flex h-full shrink-0 flex-col items-stretch py-2"
      style={{ width: "var(--activitybar-width)" }}
    >
      <nav aria-label="Activity bar" className="flex flex-col items-stretch">
        {VIEW_ITEMS.map((item) => (
          <ActivityBarItem
            key={item.view}
            icon={item.icon}
            label={item.label}
            shortcut={item.shortcut}
            active={activityView === item.view && primarySideBarVisible}
            testId={`activitybar-${item.view}`}
            onClick={() => onSelectView(item.view)}
          />
        ))}
        {TAB_ITEMS.map((item) => (
          <ActivityBarItem
            key={item.tab}
            icon={item.icon}
            label={item.label}
            shortcut={item.shortcut}
            active={activeSystemTab === item.tab}
            testId={`activitybar-tab-${item.tab}`}
            onClick={() => onSelectTab(item.tab)}
          />
        ))}
      </nav>
    </aside>
  );
}
