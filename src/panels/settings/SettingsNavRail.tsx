import { useMemo, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import {
  Bell,
  Cpu,
  FolderGit2,
  GitBranch,
  Keyboard,
  Palette,
  Plug,
  Server,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Terminal,
  User,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { SettingsSearchInput } from "./primitives/SettingsSearchInput";

export type SectionId =
  | "general"
  | "repositories"
  | "git"
  | "models"
  | "providers"
  | "mcps"
  | "appearance"
  | "keybindings"
  | "terminal"
  | "notifications"
  | "advanced"
  | "account";

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
    label: "WORKSPACE",
    items: [
      { id: "general", label: "General", icon: SettingsIcon },
      { id: "repositories", label: "Repositories", icon: FolderGit2 },
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
    ],
  },
  {
    id: "editor",
    label: "EDITOR",
    items: [
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "keybindings", label: "Keybindings", icon: Keyboard },
      { id: "terminal", label: "Terminal", icon: Terminal },
    ],
  },
  {
    id: "system",
    label: "SYSTEM",
    items: [
      { id: "notifications", label: "Notifications", icon: Bell },
      { id: "advanced", label: "Advanced", icon: SlidersHorizontal },
      { id: "account", label: "Account", icon: User },
    ],
  },
];

interface Props {
  section: SectionId;
  onSelect: (id: SectionId) => void;
}

export function SettingsNavRail({ section, onSelect }: Props) {
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
      className="flex h-full w-settings-nav flex-col gap-2 border-r border-border/30 bg-card/40 px-2 py-3"
    >
      <div className="px-1">
        <SettingsSearchInput value={query} onChange={setQuery} placeholder="Search…" />
      </div>
      <div className="flex-1 overflow-y-auto">
        {groupsToRender.map((group) =>
          group.renderHeader ? (
            <div key={group.id} className="mb-2">
              <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
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
                      "relative flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors",
                      selected
                        ? "bg-accent/15 text-foreground"
                        : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                    )}
                  >
                    {selected ? (
                      <motion.span
                        layoutId="settings-nav-indicator"
                        className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-sm bg-accent"
                      />
                    ) : null}
                    <Icon className="h-3.5 w-3.5" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ) : null,
        )}
      </div>
    </nav>
  );
}

export type { NavGroup, NavItem };
