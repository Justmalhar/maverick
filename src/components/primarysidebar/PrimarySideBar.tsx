import { LayoutDashboard, CheckSquare2, Zap, Plug } from "lucide-react";
import { useWorkbench, type SystemTabId } from "@/state/store";
import { cn } from "@/lib/utils";
import { ProjectsView } from "./ProjectsView";

const NAV_ITEMS: Array<{
  tab: SystemTabId;
  icon: typeof LayoutDashboard;
  label: string;
}> = [
  { tab: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { tab: "kanban", icon: CheckSquare2, label: "Tasks" },
  { tab: "automations", icon: Zap, label: "Automations" },
  { tab: "mcps", icon: Plug, label: "MCPs" },
];

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
  testId,
}: {
  icon: typeof LayoutDashboard;
  label: string;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors duration-100",
        active
          ? "bg-sidebar-selected text-foreground"
          : "text-sidebar-fg hover:bg-sidebar-hover hover:text-foreground"
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label}
    </button>
  );
}

export function PrimarySideBar() {
  const activeSystemTab = useWorkbench((s) => s.activeSystemTab);
  const systemTabs = useWorkbench((s) => s.systemTabs);
  const openSystemTab = useWorkbench((s) => s.openSystemTab);
  const setActiveSystemTab = useWorkbench((s) => s.setActiveSystemTab);

  function onNav(tab: SystemTabId) {
    if (systemTabs.includes(tab)) {
      setActiveSystemTab(tab);
    } else {
      openSystemTab(tab);
    }
  }

  return (
    <section
      data-testid="primary-sidebar"
      className="mv-primarysidebar flex h-full w-full flex-col overflow-hidden bg-sidebar text-sidebar-fg"
    >
      <nav
        aria-label="Sidebar navigation"
        className="flex shrink-0 flex-col gap-px px-2 py-2"
      >
        {NAV_ITEMS.map((item) => (
          <NavItem
            key={item.tab}
            icon={item.icon}
            label={item.label}
            active={activeSystemTab === item.tab}
            testId={`sidebar-nav-${item.tab}`}
            onClick={() => onNav(item.tab)}
          />
        ))}
      </nav>

      <div className="border-t border-border-glass" />

      <div className="flex-1 overflow-hidden">
        <ProjectsView />
      </div>
    </section>
  );
}
