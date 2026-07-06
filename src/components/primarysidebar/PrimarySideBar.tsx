import { LayoutDashboard, Gauge, CheckSquare2 } from "lucide-react";
import { useWorkbench, type SystemTabId } from "@/state/store";
import { cn } from "@/lib/utils";
import { ProjectsView } from "./ProjectsView";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Tabs open as documents in the EditorArea.
const NAV_ITEMS: Array<{
  tab: SystemTabId;
  icon: typeof LayoutDashboard;
  label: string;
}> = [
  { tab: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { tab: "usage", icon: Gauge, label: "Usage" },
  { tab: "kanban", icon: CheckSquare2, label: "Tasks" },
];

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
  testId,
  collapsed,
}: {
  icon: typeof LayoutDashboard;
  label: string;
  active: boolean;
  onClick: () => void;
  testId: string;
  collapsed?: boolean;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "flex items-center rounded-md transition-colors duration-100",
        collapsed
          ? "h-8 w-8 justify-center"
          : "w-full gap-2.5 px-2.5 py-1.5 text-[13px]",
        active
          ? "bg-sidebar-selected text-sidebar-selected-fg"
          : "text-sidebar-fg hover:bg-sidebar-hover hover:text-foreground"
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {!collapsed && <span>{label}</span>}
    </button>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  }

  return button;
}

export function PrimarySideBar({ collapsed = false }: { collapsed?: boolean }) {
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
      className={cn(
        "mv-primarysidebar glass flex h-full flex-col overflow-hidden text-sidebar-fg",
        collapsed ? "w-12 items-center" : "w-full"
      )}
    >
      <nav
        aria-label="Sidebar navigation"
        className={cn(
          "flex shrink-0 flex-col",
          collapsed ? "gap-1 px-1 py-2" : "gap-px px-2 py-2"
        )}
      >
        {NAV_ITEMS.map((item) => (
          <NavItem
            key={item.tab}
            icon={item.icon}
            label={item.label}
            active={activeSystemTab === item.tab}
            testId={`sidebar-nav-${item.tab}`}
            onClick={() => onNav(item.tab)}
            collapsed={collapsed}
          />
        ))}
      </nav>

      <div style={{ borderTop: "1px solid hsl(var(--border-glass))" }} />

      <div className="min-h-0 flex-1">
        <ProjectsView collapsed={collapsed} />
      </div>
    </section>
  );
}
