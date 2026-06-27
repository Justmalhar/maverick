import { useEffect, useState } from "react";
import { Boxes, Activity, Moon, FolderGit2, GitCompare, Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useWorkbench } from "@/state/store";
import { useAgentStatus, useAgentStatusStore } from "@/hooks/useAgentStatus";
import { AgentStatusPill } from "@/components/editor/AgentStatusPill";
import { brandFor } from "@/lib/backend-brand";
import { diffGet } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { Workspace } from "@/lib/ipc";

interface DiffStats {
  files: number;
  additions: number;
  deletions: number;
}

export function DashboardView() {
  const reduce = useReducedMotion();
  const workspaces = useWorkbench((s) => s.workspaces);
  const projects = useWorkbench((s) => s.projects);
  const statuses = useAgentStatusStore((s) => s.statuses);

  const projectName = (id: string) =>
    projects.find((p) => p.id === id)?.name ?? "Unknown project";

  const statusOf = (id: string) => statuses[id] ?? "idle";
  const activeCount = workspaces.filter((w) => {
    const status = statusOf(w.id);
    return status === "working" || status === "attention";
  }).length;
  const idleCount = workspaces.filter((w) => statusOf(w.id) === "idle").length;

  const summary =
    workspaces.length === 0
      ? "No agents running yet"
      : `${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"} · ${activeCount} active`;

  return (
    <motion.div
      data-testid="dashboard-view"
      className="h-full w-full overflow-auto bg-editor"
      initial={reduce ? false : { opacity: 0 }}
      animate={reduce ? undefined : { opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-8 py-16">
        <header
          data-testid="dashboard-header"
          className="flex flex-col items-center gap-4 text-center"
        >
          <img
            src="/app-icon.png"
            alt=""
            width={72}
            height={72}
            className="shrink-0 rounded-2xl shadow-md"
          />
          <div className="flex flex-col items-center gap-1.5">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Maverick
            </h1>
            <span className="text-sm text-muted-foreground">{summary}</span>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            testId="dashboard-stat-workspaces"
            icon={Boxes}
            label="Workspaces"
            value={String(workspaces.length)}
          />
          <StatCard
            testId="dashboard-stat-active"
            icon={Activity}
            label="Active"
            value={String(activeCount)}
            accent={activeCount > 0}
          />
          <StatCard
            testId="dashboard-stat-idle"
            icon={Moon}
            label="Idle"
            value={String(idleCount)}
          />
          <StatCard
            testId="dashboard-stat-projects"
            icon={FolderGit2}
            label="Projects"
            value={String(projects.length)}
          />
        </div>

        {workspaces.length === 0 ? (
          <div
            data-testid="dashboard-empty"
            className="flex flex-col items-center gap-3 rounded-xl border border-border-glass bg-card px-6 py-16 text-center"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <span className="text-sm text-foreground">No active agents</span>
            <p className="max-w-sm text-[13px] text-muted-foreground">
              Start a workspace from a project or a task to run an agent here.
            </p>
          </div>
        ) : (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[11px] uppercase tracking-wider text-sidebar-section">
                Agents
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {workspaces.length}
              </span>
            </div>
            <ul className="flex flex-col gap-2">
              {workspaces.map((w) => (
                <AgentCard key={w.id} workspace={w} projectName={projectName(w.projectId)} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </motion.div>
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

  const brand = brandFor(workspace.agentBackend);
  const backendLabel = brand?.label ?? workspace.agentBackend;

  function openChanges(e: React.MouseEvent) {
    // Don't also trigger the card's focus handler — this does both itself.
    e.stopPropagation();
    setActiveWorkspace(workspace.id);
    openSourceControl();
  }

  // Re-fetch the worktree diff summary whenever the agent goes quiet — a fresh
  // `working`/`done` transition is the cheapest signal that the tree changed.
  useEffect(() => {
    // Only refresh the diff on settled states — skip the rapid working/attention
    // churn so the dashboard doesn't fire a diff_get per status flip per card.
    if (status === "working" || status === "attention") return;
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
          "flex w-full items-start gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors duration-100",
          isActive
            ? "border-border bg-sidebar-selected text-sidebar-selected-fg"
            : "border-border-glass bg-card text-sidebar-fg hover:bg-sidebar-hover hover:text-foreground"
        )}
      >
        <span
          data-testid={`dashboard-agent-backend-${workspace.id}`}
          aria-label={backendLabel}
          title={backendLabel}
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-foreground"
        >
          {brand ? (
            <brand.Icon size={16} />
          ) : (
            <span className="text-[9px] font-mono uppercase text-muted-foreground">
              {backendLabel.slice(0, 2)}
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-[13px] font-medium">
              {workspace.title || workspace.branch}
            </span>
            <AgentStatusPill status={status} compact />
          </span>
          <span className="flex items-center gap-1.5 overflow-hidden text-[11px] text-muted-foreground">
            <span className="truncate">{projectName}</span>
            <span className="shrink-0">·</span>
            <span className="truncate font-mono">{workspace.branch}</span>
          </span>
          {stats && (
            <span
              data-testid={`dashboard-agent-stats-${workspace.id}`}
              className="flex items-center gap-2 text-[10px] font-mono"
            >
              <span className="text-muted-foreground">
                {stats.files} file{stats.files === 1 ? "" : "s"}
              </span>
              <span className="text-success">+{stats.additions}</span>
              <span className="text-destructive">−{stats.deletions}</span>
            </span>
          )}
        </span>
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
  icon: Icon,
  accent = false,
}: {
  label: string;
  value: string;
  testId: string;
  icon: typeof Boxes;
  accent?: boolean;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-3 rounded-xl border border-border-glass bg-card px-4 py-4"
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          accent ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-sidebar-section">{label}</span>
        <span className="font-mono text-2xl font-semibold leading-none text-foreground">{value}</span>
      </span>
    </div>
  );
}
