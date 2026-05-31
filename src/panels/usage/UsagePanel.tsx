// Usage Manager — shows estimated token consumption + cost per backend.
// Figures are client-side estimates aggregated from each open workspace's
// session usage (context.usage RPC), refreshed on context-update broadcasts.
import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  Coins,
  Cpu,
  DollarSign,
  Gauge,
  Zap,
} from "lucide-react";
import { useWorkbench } from "@/state/store";
import { contextUsage } from "@/lib/tauri";
import { cn } from "@/lib/utils";

interface BackendUsage {
  name: string;
  tokensUsed: number;
  tokensLimit: number;
  activeSessions: number;
  sessionsLimit: number;
  costUSD: number;
}

// Fallback context window for a backend that has not reported usage yet; the
// live limit is the per-session contextWindow surfaced by context.usage.
const FALLBACK_CONTEXT_WINDOW = 200_000;
// Soft ceiling for the active-sessions meter until a backend exposes its own.
const DEFAULT_SESSIONS_LIMIT = 50;

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function pct(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

export default function UsagePanel() {
  const reduce = useReducedMotion();
  const backends = useWorkbench((s) => s.backends);
  const workspaces = useWorkbench((s) => s.workspaces);
  const [usageByBackend, setUsageByBackend] = useState<
    Record<string, { tokens: number; cost: number; sessions: number; window: number }>
  >({});

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const acc: Record<
        string,
        { tokens: number; cost: number; sessions: number; window: number }
      > = {};
      await Promise.all(
        workspaces.map(async (ws) => {
          if (!ws.sessionId) return;
          try {
            const u = await contextUsage(ws.sessionId);
            const key = ws.agentBackend;
            const entry = acc[key] ?? { tokens: 0, cost: 0, sessions: 0, window: 0 };
            entry.tokens += u.tokensUsed;
            entry.cost += u.sessionCostEstimate;
            // Sessions that have consumed any tokens — a coarse activity signal,
            // not an API request count.
            entry.sessions += u.tokensUsed > 0 ? 1 : 0;
            // The token limit is the backend's reported context window, not a
            // hardcoded constant; take the largest window seen for the backend.
            entry.window = Math.max(entry.window, u.contextWindow);
            acc[key] = entry;
          } catch {
            /* skip sessions without usage */
          }
        })
      );
      if (!cancelled) setUsageByBackend(acc);
    }
    void refresh();
    function onUpdated() {
      void refresh();
    }
    window.addEventListener("maverick:context:updated", onUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("maverick:context:updated", onUpdated);
    };
  }, [workspaces]);

  const rows: BackendUsage[] = useMemo(() => {
    const names =
      backends.length > 0
        ? backends.map((b) => b.name)
        : ["claude-code", "codex", "gemini"];
    // Surface any backend that has recorded usage even if it isn't configured.
    for (const key of Object.keys(usageByBackend)) {
      if (!names.includes(key)) names.push(key);
    }
    return names.map((name) => {
      const u = usageByBackend[name] ?? { tokens: 0, cost: 0, sessions: 0, window: 0 };
      return {
        name,
        tokensUsed: u.tokens,
        tokensLimit: u.window > 0 ? u.window : FALLBACK_CONTEXT_WINDOW,
        activeSessions: u.sessions,
        sessionsLimit: DEFAULT_SESSIONS_LIMIT,
        costUSD: u.cost,
      };
    });
  }, [backends, usageByBackend]);

  const totalTokens = rows.reduce((sum, r) => sum + r.tokensUsed, 0);
  const totalCost = rows.reduce((sum, r) => sum + r.costUSD, 0);
  const totalActiveSessions = rows.reduce((sum, r) => sum + r.activeSessions, 0);

  return (
    <motion.div
      data-testid="usage-panel"
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="flex h-full w-full overflow-auto bg-editor"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-12 py-10">
        <header className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Gauge className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Usage
            </h1>
            <p className="text-[13px] text-muted-foreground">
              Token limits, active sessions, and session cost across backends.
            </p>
          </div>
        </header>

        <section
          className="grid grid-cols-1 gap-3 md:grid-cols-3"
          data-testid="usage-summary"
        >
          <StatCard
            icon={Coins}
            label="Tokens today"
            value={formatTokens(totalTokens)}
            hint={`${workspaces.length} active workspaces`}
          />
          <StatCard
            icon={Activity}
            label="Active sessions"
            value={String(totalActiveSessions)}
            hint="Sessions with token usage · estimate"
          />
          <StatCard
            icon={DollarSign}
            label="Session cost"
            value={`$${totalCost.toFixed(2)}`}
            hint="Estimate · resets daily"
          />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-section">
            Backends
          </h2>
          <div
            className="flex flex-col divide-y divide-border-glass rounded-lg bg-card"
            style={{ border: "1px solid hsl(var(--border))" }}
            data-testid="usage-backends"
          >
            {rows.map((row) => (
              <BackendRow key={row.name} row={row} />
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-section">
            Tips
          </h2>
          <ul className="flex flex-col gap-1.5 text-[13px] text-muted-foreground">
            <li className="flex items-start gap-2">
              <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>
                Skills and prompts that reference <code className="font-mono text-[12px] text-foreground">@attachment:</code> avoid pulling
                large pastes into context.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>
                Quotas come from each backend's own config — Maverick does not
                bill you, only surfaces what your CLIs report.
              </span>
            </li>
          </ul>
        </section>
      </div>
    </motion.div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div
      className="flex flex-col gap-2 rounded-lg bg-card px-4 py-3.5"
      style={{ border: "1px solid hsl(var(--border))" }}
      data-testid={`usage-stat-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-sidebar-section">
          {label}
        </span>
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <span className="text-2xl font-semibold tracking-tight text-foreground">
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}

function BackendRow({ row }: { row: BackendUsage }) {
  const tokensPct = pct(row.tokensUsed, row.tokensLimit);
  const sessionsPct = pct(row.activeSessions, row.sessionsLimit);
  const tone =
    tokensPct >= 90 ? "destructive" : tokensPct >= 70 ? "warning" : "primary";
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[13px] text-foreground">{row.name}</span>
        <span className="text-[11px] text-muted-foreground">
          ${row.costUSD.toFixed(2)} session
        </span>
      </div>

      <Meter
        label="Tokens"
        used={formatTokens(row.tokensUsed)}
        limit={formatTokens(row.tokensLimit)}
        percent={tokensPct}
        tone={tone}
      />
      <Meter
        label="Active sessions"
        used={String(row.activeSessions)}
        limit={String(row.sessionsLimit)}
        percent={sessionsPct}
        tone={sessionsPct >= 90 ? "destructive" : "primary"}
      />
    </div>
  );
}

function Meter({
  label,
  used,
  limit,
  percent,
  tone,
}: {
  label: string;
  used: string;
  limit: string;
  percent: number;
  tone: "primary" | "warning" | "destructive";
}) {
  /* v8 ignore next 5 */
  const toneClass =
    tone === "destructive"
      ? "bg-destructive"
      : tone === "warning"
        ? "bg-warning"
        : "bg-primary";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="uppercase tracking-wider text-sidebar-section">
          {label}
        </span>
        <span className="font-mono text-muted-foreground">
          {used} <span className="text-foreground/40">/</span> {limit}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={cn("h-full rounded-full transition-all duration-300", toneClass)}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
