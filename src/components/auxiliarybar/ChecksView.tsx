import { useEffect, useState } from "react";
import {
  CircleCheck,
  CircleX,
  Circle,
  Clock,
  GitBranch,
  GitPullRequest,
  ListChecks,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useWorkbench, selectContextWorkspace } from "@/state/store";
import { useAgentStatus } from "@/hooks/useAgentStatus";
import { checksGet } from "@/lib/tauri";
import type { CheckStatus, ChecksReport } from "@/lib/ipc";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type Load =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; report: ChecksReport }
  | { kind: "error"; message: string };

const STATUS_META: Record<CheckStatus, { icon: typeof Circle; tone: string }> = {
  pass: { icon: CircleCheck, tone: "text-success" },
  fail: { icon: CircleX, tone: "text-destructive" },
  pending: { icon: Clock, tone: "text-warning" },
  neutral: { icon: Circle, tone: "text-muted-foreground" },
};

function Section({
  icon: Icon,
  title,
  children,
  testId,
}: {
  icon: typeof GitBranch;
  title: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section data-testid={testId} className="flex flex-col gap-1.5 px-3 py-2">
      <h3 className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-sidebar-section">
        <Icon className="h-3 w-3" />
        {title}
      </h3>
      {children}
    </section>
  );
}

export function ChecksView() {
  const active = useWorkbench(selectContextWorkspace);
  const status = useAgentStatus(active?.id ?? "");
  const [load, setLoad] = useState<Load>({ kind: "idle" });
  const [refreshKey, setRefreshKey] = useState(0);
  const worktreePath = active?.worktreePath ?? null;

  // Re-fetch on mount, when the agent goes quiet (cheap "tree changed" signal,
  // same heuristic as the Agents Dashboard), and on manual refresh.
  useEffect(() => {
    if (!worktreePath) {
      setLoad({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setLoad({ kind: "loading" });
    checksGet(worktreePath)
      .then((report) => {
        if (!cancelled) setLoad({ kind: "ready", report });
      })
      .catch((e) => {
        if (!cancelled) setLoad({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [worktreePath, status, refreshKey]);

  if (!active) {
    return (
      <div
        data-testid="checks-empty"
        className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center"
      >
        <ListChecks className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
        <span className="text-[13px] text-foreground">No active workspace</span>
        <p className="max-w-xs text-xs text-muted-foreground">
          Open a workspace to see its merge-readiness checks.
        </p>
      </div>
    );
  }

  return (
    <div className="mv-checksview flex h-full flex-col" data-testid="checks-view">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <ListChecks className="h-3.5 w-3.5 shrink-0 text-sidebar-fg" />
        <span className="font-medium text-foreground">Checks</span>
        <button
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
          aria-label="Refresh"
          data-testid="checks-refresh"
          className="ml-auto flex h-5 w-5 items-center justify-center rounded-sm text-sidebar-fg transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground"
        >
          {load.kind === "loading" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
        </button>
      </div>

      {load.kind === "error" ? (
        <p data-testid="checks-error" className="px-3 py-2 text-[11px] text-destructive">
          Couldn't load checks: {load.message}
        </p>
      ) : load.kind === "ready" ? (
        <ScrollArea className="flex-1">
          <Report report={load.report} />
        </ScrollArea>
      ) : (
        <div data-testid="checks-loading" className="flex flex-1 items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

function Report({ report }: { report: ChecksReport }) {
  const { git, pr, ghAvailable, checks, merge } = report;
  return (
    <div className="flex flex-col divide-y divide-border">
      {/* Merge readiness banner */}
      <div
        data-testid="checks-merge"
        data-ready={merge.ready}
        className={cn(
          "flex flex-col gap-1.5 px-3 py-2.5",
          merge.ready ? "text-success" : "text-warning"
        )}
      >
        <span className="flex items-center gap-1.5 text-[12px] font-medium">
          {merge.ready ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
          {merge.ready ? "Ready to merge" : "Not ready to merge"}
        </span>
        {!merge.ready && (
          <ul className="flex flex-col gap-0.5 pl-5">
            {merge.blockers.map((b) => (
              <li
                key={b}
                data-testid="checks-blocker"
                className="list-disc text-[11px] text-muted-foreground"
              >
                {b}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Section icon={GitBranch} title="Git" testId="checks-git">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground">
          <span className="truncate font-mono">{git.branch}</span>
          {git.ahead > 0 && <span className="text-success">↑{git.ahead}</span>}
          {git.behind > 0 && <span className="text-warning">↓{git.behind}</span>}
          <span className="text-muted-foreground">
            {git.changedFiles} changed
          </span>
          {git.conflicts > 0 && (
            <span className="text-destructive">{git.conflicts} conflicts</span>
          )}
        </div>
      </Section>

      <Section icon={GitPullRequest} title="Pull request" testId="checks-pr">
        {pr ? (
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            data-testid="checks-pr-link"
            className="flex items-center gap-1.5 text-[11px] text-info hover:underline"
          >
            <span className="font-mono">#{pr.number}</span>
            <span className="text-muted-foreground">{pr.state}</span>
            <span className="truncate text-foreground">{pr.title}</span>
          </a>
        ) : ghAvailable ? (
          <p className="text-[11px] text-muted-foreground">
            No pull request yet — create one from the Changes tab.
          </p>
        ) : (
          <p data-testid="checks-gh-unavailable" className="text-[11px] text-muted-foreground">
            Install and authenticate the GitHub CLI (<span className="font-mono">gh auth login</span>)
            to see PR and CI status.
          </p>
        )}
      </Section>

      {checks.length > 0 && (
        <Section icon={ListChecks} title="Checks" testId="checks-list">
          <ul className="flex flex-col gap-1">
            {checks.map((c) => {
              const meta = STATUS_META[c.status];
              const Icon = meta.icon;
              return (
                <li
                  key={c.name}
                  data-testid={`checks-item-${c.name}`}
                  data-status={c.status}
                  className="flex items-center gap-1.5 text-[11px] text-foreground"
                >
                  <Icon className={cn("h-3.5 w-3.5 shrink-0", meta.tone)} />
                  <span className="truncate">{c.name}</span>
                  {c.detail && <span className="truncate text-muted-foreground">{c.detail}</span>}
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </div>
  );
}
