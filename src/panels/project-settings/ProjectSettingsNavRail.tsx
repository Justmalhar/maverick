import { cn } from "@/lib/utils";

export type ProjectSection =
  | "identity"
  | "workspaces"
  | "preview"
  | "scripts"
  | "preferences";

interface NavItem {
  id: ProjectSection;
  label: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  { label: "ABOUT", items: [{ id: "identity", label: "Identity" }] },
  {
    label: "WORKSPACES",
    items: [
      { id: "workspaces", label: "Workspaces" },
      { id: "preview", label: "Preview" },
    ],
  },
  { label: "EXECUTION", items: [{ id: "scripts", label: "Scripts" }] },
  { label: "AGENT", items: [{ id: "preferences", label: "Preferences" }] },
];

interface Props {
  section: ProjectSection;
  onSelect: (id: ProjectSection) => void;
}

export function ProjectSettingsNavRail({ section, onSelect }: Props) {
  return (
    <nav
      aria-label="Project settings sections"
      className="flex h-full w-full flex-col gap-3 bg-sidebar px-2 py-3 text-[12px]"
    >
      {GROUPS.map((group) => (
        <div key={group.label}>
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {group.label}
          </div>
          <ul>
            {group.items.map((item) => {
              const selected = section === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    data-testid={`project-nav-${item.id}`}
                    aria-current={selected ? "page" : undefined}
                    onClick={() => onSelect(item.id)}
                    className={cn(
                      "flex h-8 w-full items-center rounded-md px-2.5 text-left text-[13px] transition-colors duration-100",
                      selected
                        ? "bg-accent/20 text-foreground"
                        : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                    )}
                  >
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
