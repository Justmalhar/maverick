import { useMemo, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import {
  Bell,
  Code2,
  Cpu,
  GitBranch,
  Info,
  Keyboard,
  Palette,
  Plug,
  Server,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Variable,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SettingsSearchInput } from "./primitives/SettingsSearchInput";

export type SectionId =
  | "general"
  | "environment"
  | "git"
  | "models"
  | "providers"
  | "mcps"
  | "skills"
  | "appearance"
  | "keybindings"
  | "terminal"
  | "notifications"
  | "advanced"
  | "version";

interface NavItem {
  id: SectionId;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "workspace",
    label: "Workspace",
    items: [
      { id: "general", label: "General", icon: SettingsIcon },
      { id: "environment", label: "Environment", icon: Variable },
      { id: "git", label: "Git", icon: GitBranch },
    ],
  },
  {
    id: "ai",
    label: "AI",
    items: [
      { id: "models", label: "Models", icon: Cpu },
      { id: "providers", label: "Providers", icon: Plug },
      { id: "mcps", label: "MCPs", icon: Server },
      { id: "skills", label: "Skills", icon: Sparkles },
    ],
  },
  {
    id: "editor",
    label: "Editor",
    items: [
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "keybindings", label: "Keybindings", icon: Keyboard },
      { id: "terminal", label: "Terminal", icon: Terminal },
    ],
  },
  {
    id: "system",
    label: "System",
    items: [
      { id: "notifications", label: "Notifications", icon: Bell },
      { id: "advanced", label: "Advanced", icon: SlidersHorizontal },
      { id: "version", label: "Version", icon: Info },
    ],
  },
];

interface Props {
  section: SectionId;
  onSelect: (id: SectionId) => void;
  onOpenFile?: () => void;
}

export function SettingsNavRail({ section, onSelect, onOpenFile }: Props) {
  const [query, setQuery] = useState("");
  const itemRefs = useRef<Map<SectionId, HTMLButtonElement>>(new Map());

  const groupsToRender = useMemo(() => {
    const q = query.trim().toLowerCase();
    return NAV_GROUPS.map((group) => {
      const filtered = q
        ? group.items.filter((item) => item.label.toLowerCase().includes(q))
        : group.items;
      const containsSelected = group.items.some((item) => item.id === section);
      return {
        ...group,
        items: filtered,
        renderHeader: filtered.length > 0 || containsSelected,
      };
    });
  }, [query, section]);

  const visibleIds = useMemo(
    () => groupsToRender.flatMap((g) => g.items.map((i) => i.id)),
    [groupsToRender],
  );

  const handleSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "Enter") return;
    if (visibleIds.length === 0) return;
    e.preventDefault();
    if (e.key === "ArrowDown") {
      itemRefs.current.get(visibleIds[0])?.focus();
    } else {
      onSelect(visibleIds[0]);
    }
  };

  const handleItemKey = (e: KeyboardEvent<HTMLButtonElement>, id: SectionId) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
    e.preventDefault();
    if (e.key === "Enter") {
      onSelect(id);
      return;
    }
    const idx = visibleIds.indexOf(id);
    const next = e.key === "ArrowDown" ? visibleIds[idx + 1] : visibleIds[idx - 1];
    if (next) itemRefs.current.get(next)?.focus();
  };

  return (
    <nav
      aria-label="Settings sections"
      onKeyDownCapture={(e) => {
        const target = e.target as HTMLElement;
        if (target.getAttribute("role") === "searchbox") {
          handleSearchKey(e as unknown as KeyboardEvent<HTMLInputElement>);
        }
      }}
      className="flex h-full w-full flex-col gap-2 bg-sidebar px-2 py-3"
      style={{ borderRight: "1px solid hsl(var(--border))" }}
    >
      <div className="px-1">
        <SettingsSearchInput value={query} onChange={setQuery} placeholder="Search…" />
      </div>
      <div className="flex-1 overflow-y-auto">{/* nav items */}
        {groupsToRender.map((group) =>
          group.renderHeader ? (
            <div key={group.id} className="mb-3">
              <div className="px-2 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </div>
              {group.items.map((item) => {
                const Icon = item.icon;
                const selected = item.id === section;
                return (
                  <button
                    key={item.id}
                    ref={(node) => {
                      if (node) itemRefs.current.set(item.id, node);
                      else itemRefs.current.delete(item.id);
                    }}
                    type="button"
                    data-testid={`settings-nav-${item.id}`}
                    aria-current={selected ? "page" : undefined}
                    onClick={() => onSelect(item.id)}
                    onKeyDown={(e) => handleItemKey(e, item.id)}
                    className={cn(
                      "relative flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] transition-colors",
                      selected
                        ? "bg-accent/20 text-foreground"
                        : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ) : null,
        )}
      </div>
      {onOpenFile ? (
        <div className="pt-2" style={{ borderTop: "1px solid hsl(var(--border) / 0.4)" }}>
          <button
            type="button"
            onClick={onOpenFile}
            data-testid="settings-open-file"
            className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            <Code2 className="h-4 w-4" />
            <span>Open settings.json</span>
          </button>
        </div>
      ) : null}
    </nav>
  );
}

export type { NavGroup, NavItem };
