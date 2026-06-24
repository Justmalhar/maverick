import { useEffect, useState } from "react";
import { GitCompare } from "lucide-react";
import { useWorkbench } from "@/state/store";
import { useAgentStatus, useAgentStatusStore } from "@/hooks/useAgentStatus";
import { AgentStatusPill } from "@/components/editor/AgentStatusPill";
import { diffGet } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { Workspace } from "@/lib/ipc";

interface DiffStats {
  files: number;
  additions: number;
  deletions: number;
}

export function DashboardView() {
  const workspaces = useWorkbench((s) => s.workspaces);
  const projects = useWorkbench((s) => s.projects);
  const statuses = useAgentStatusStore((s) => s.statuses);

  const projectName = (id: string) =>
    projects.find((p) => p.id === id)?.name ?? "Unknown project";

  const activeCount = workspaces.filter((w) => {
    const status = statuses[w.id] ?? "idle";
    return status === "working" || status === "attention";
  }).length;

  return (
    <div
      data-testid="dashboard-view"
      className="flex flex-col gap-4 overflow-auto px-3 py-3"
    >
      <div className="grid grid-cols-2 gap-2">
        <StatCard testId="dashboard-stat-workspaces" label="Workspaces" value={String(workspaces.length)} />
        <StatCard testId="dashboard-stat-active" label="Active" value={String(activeCount)} />
      </div>

      {workspaces.length === 0 ? (
        <div
          data-testid="dashboard-empty"
          className="flex flex-col items-center gap-1 rounded-md border border-border-glass bg-card px-3 py-6 text-center"
        >
          <span className="text-[13px] text-foreground">No active agents</span>
          <p className="max-w-xs text-xs text-muted-foreground">
            Start a workspace from a project or a task to run an agent here.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {workspaces.map((w) => (
            <AgentCard key={w.id} workspace={w} projectName={projectName(w.projectId)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AgentCard({
  workspace,
  projectName,
}: {
  workspace: Workspace;
  projectName: string;
}) {
  const status = useAgentStatus(workspace.id);
  const isActive = useWorkbench((s) => s.activeWorkspaceId === workspace.id);
  const setActiveWorkspace = useWorkbench((s) => s.setActiveWorkspace);
  const openSourceControl = useWorkbench((s) => s.openSourceControl);
  const [stats, setStats] = useState<DiffStats | null>(null);

  function openChanges(e: React.MouseEvent) {
    // Don't also trigger the card's focus handler — this does both itself.
    e.stopPropagation();
    setActiveWorkspace(workspace.id);
    openSourceControl();
  }

  // Re-fetch the worktree diff summary whenever the agent goes quiet — a fresh
  // `working`/`done` transition is the cheapest signal that the tree changed.
  useEffect(() => {
    let cancelled = false;
    diffGet(workspace.worktreePath)
      .then((diff) => {
        if (cancelled) return;
        const files = diff?.files ?? [];
        setStats(
          files.length === 0
            ? null
            : {
                files: files.length,
                additions: files.reduce((n, f) => n + f.additions, 0),
                deletions: files.reduce((n, f) => n + f.deletions, 0),
              }
        );
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace.worktreePath, status]);

  return (
    <li className="group relative">
      <button
        type="button"
        data-testid={`dashboard-agent-${workspace.id}`}
        data-status={status}
        data-active={isActive}
        onClick={() => setActiveWorkspace(workspace.id)}
        className={cn(
          "flex w-full flex-col gap-1.5 rounded-md border px-2.5 py-2 text-left transition-colors duration-100",
          isActive
            ? "border-border bg-sidebar-selected text-sidebar-selected-fg"
            : "border-border-glass bg-card text-sidebar-fg hover:bg-sidebar-hover hover:text-foreground"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-medium">
            {workspace.title || workspace.branch}
          </span>
          <AgentStatusPill status={status} compact />
        </div>
        <div className="flex items-center gap-2 overflow-hidden text-[11px] text-muted-foreground">
          <span className="truncate">{projectName}</span>
          <span className="shrink-0">·</span>
          <span className="truncate font-mono">{workspace.branch}</span>
          <span className="shrink-0">·</span>
          <span className="shrink-0 font-mono">{workspace.agentBackend}</span>
        </div>
        {stats && (
          <div
            data-testid={`dashboard-agent-stats-${workspace.id}`}
            className="flex items-center gap-2 text-[10px] font-mono"
          >
            <span className="text-muted-foreground">
              {stats.files} file{stats.files === 1 ? "" : "s"}
            </span>
            <span className="text-success">+{stats.additions}</span>
            <span className="text-destructive">−{stats.deletions}</span>
          </div>
        )}
      </button>
      <button
        type="button"
        data-testid={`dashboard-agent-open-changes-${workspace.id}`}
        onClick={openChanges}
        aria-label="Open changes"
        title="Open changes"
        className="absolute bottom-1.5 right-1.5 rounded p-1 text-muted-foreground opacity-0 transition-opacity duration-100 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
      >
        <GitCompare className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function StatCard({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-0.5 rounded-md border border-border-glass bg-card px-2.5 py-2"
    >
      <span className="text-[10px] uppercase tracking-wider text-sidebar-section">{label}</span>
      <span className="font-mono text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}
