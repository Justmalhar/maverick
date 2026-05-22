import { useWorkbench } from "@/state/store";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";

const MAX_VISIBLE = 5;

const PROJECT_COLORS = [
  "bg-blue-500",
  "bg-violet-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-pink-500",
  "bg-indigo-500",
];

function projectColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0xffffffff;
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length];
}

interface Props {
  filterProjectId: string | null;
  onFilterChange: (id: string | null) => void;
}

export default function ProjectFilterTabs({ filterProjectId, onFilterChange }: Props) {
  const projects = useWorkbench((s) => s.projects);
  const visible = projects.slice(0, MAX_VISIBLE);
  const overflow = projects.slice(MAX_VISIBLE);

  const tabClass = (active: boolean) =>
    cn(
      "flex items-center gap-1.5 px-3 py-2 text-[12px] whitespace-nowrap border-b-2 transition-colors",
      active
        ? "border-primary text-foreground font-medium"
        : "border-transparent text-muted-foreground hover:text-foreground"
    );

  return (
    <div
      data-testid="project-filter-tabs"
      className="flex items-center overflow-x-auto border-b border-border/60 bg-card/10"
    >
      <button
        type="button"
        data-testid="filter-all"
        onClick={() => onFilterChange(null)}
        className={tabClass(filterProjectId === null)}
      >
        All projects
      </button>
      {visible.map((p) => (
        <button
          key={p.id}
          type="button"
          data-testid={`filter-project-${p.id}`}
          onClick={() => onFilterChange(p.id)}
          className={tabClass(filterProjectId === p.id)}
        >
          <span
            className={cn(
              "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm text-[8px] font-bold text-white",
              projectColor(p.id)
            )}
          >
            {p.name.slice(0, 1).toUpperCase()}
          </span>
          {p.name}
        </button>
      ))}
      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-[12px] text-muted-foreground"
              data-testid="filter-more"
            >
              More <ChevronDown className="ml-1 h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {overflow.map((p) => (
              <DropdownMenuItem
                key={p.id}
                onClick={() => onFilterChange(p.id)}
                data-testid={`filter-overflow-${p.id}`}
                className={cn("gap-2 text-[11px]", filterProjectId === p.id && "text-primary")}
              >
                <span
                  className={cn(
                    "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm text-[8px] font-bold text-white",
                    projectColor(p.id)
                  )}
                >
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                {p.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
