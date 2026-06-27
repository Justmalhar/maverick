import { ChevronRight, GitBranch, Loader2 } from "lucide-react";
import { useWorkbench, selectActiveWorkspace } from "@/state/store";
import { useSourceControl, getSourceControlRemoteIndicator } from "@/hooks/useSourceControl";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

// Branch + upstream + wrapper context strip, pinned above the EditorTabs. Moved
// here from the TitleBar breadcrumb so the active branch, its upstream ahead/
// behind, and the backend are visible next to the work, not in window chrome.
// The ahead/behind chip is the contextual remote control the old StatusBar used
// to host: it pushes when ahead, pulls when behind, fetches when level, and is
// disabled (with an explanatory tooltip) when the branch has diverged.
export function EditorBreadcrumb({ className }: Props) {
  const active = useWorkbench(selectActiveWorkspace);
  const project = useWorkbench((s) =>
    active ? s.projects.find((p) => p.id === active.projectId) : null
  );
  const scm = useSourceControl(active?.worktreePath ?? null);

  if (!active) return null;

  const branchName = scm.branch?.name ?? active.branch;
  const indicator = getSourceControlRemoteIndicator(scm);
  const busy = scm.busyAction !== null;
  const interactive = !indicator.disabled && indicator.action !== null;

  return (
    <div
      data-testid="editor-breadcrumb"
      className={cn(
        "mv-editorbreadcrumb flex h-7 shrink-0 items-center gap-1.5 border-b border-border bg-editor px-3 text-[12px] text-muted-foreground",
        className
      )}
    >
      <span className="truncate text-foreground">{project?.name ?? "Project"}</span>
      <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />
      <GitBranch className="h-3 w-3 shrink-0" />
      <span className="truncate text-foreground" data-testid="editor-breadcrumb-branch">
        {branchName}
      </span>
      {indicator.visible && (
        <button
          type="button"
          data-testid="editor-breadcrumb-sync"
          title={indicator.title}
          aria-label={indicator.title}
          disabled={!interactive}
          onClick={() => {
            if (interactive) void scm.runRemoteAction("contextual");
          }}
          className={cn(
            "flex shrink-0 items-center gap-1 rounded px-1 tabular-nums transition-colors duration-100",
            interactive && "hover:bg-sidebar-hover hover:text-foreground",
            !interactive && "cursor-default opacity-70",
            indicator.action === "push" && "text-success",
            indicator.action === "pull" && "text-warning"
          )}
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" data-testid="editor-breadcrumb-busy" />
          ) : (
            <span>{indicator.label}</span>
          )}
        </button>
      )}
      <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />
      <span className="truncate" data-testid="editor-breadcrumb-backend">
        {active.agentBackend}
      </span>
    </div>
  );
}
