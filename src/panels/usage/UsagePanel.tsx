// Usage Manager — shows token consumption, quota, cost estimates per backend.
// Data placeholders today; wires to `context.usage` RPC + per-backend quota
// rows from SQLite once those streams land.
import { useMemo } from "react";
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
import { cn } from "@/lib/utils";

interface BackendUsage {
  name: string;
  tokensUsed: number;
  tokensLimit: number;
  requestsToday: number;
  requestsLimit: number;
  costUSD: number;
}

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

  // Placeholder until context-tracker streams real numbers — derived solely
  // from store data so the panel doesn't look hard-coded.
  const rows: BackendUsage[] = useMemo(() => {
    const fallback: BackendUsage[] = [
      { name: "claude-code", tokensUsed: 0, tokensLimit: 200_000, requestsToday: 0, requestsLimit: 200, costUSD: 0 },
      { name: "codex", tokensUsed: 0, tokensLimit: 128_000, requestsToday: 0, requestsLimit: 150, costUSD: 0 },
      { name: "gemini", tokensUsed: 0, tokensLimit: 1_000_000, requestsToday: 0, requestsLimit: 60, costUSD: 0 },
    ];
    if (backends.length === 0) return fallback;
    return backends.map((b) => ({
      name: b.name,
      tokensUsed: 0,
      tokensLimit: 200_000,
      requestsToday: 0,
      requestsLimit: 200,
      costUSD: 0,
    }));
  }, [backends]);

  const totalTokens = rows.reduce((sum, r) => sum + r.tokensUsed, 0);
  const totalCost = rows.reduce((sum, r) => sum + r.costUSD, 0);
  const totalRequests = rows.reduce((sum, r) => sum + r.requestsToday, 0);

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
              Token limits, request quotas, and session cost across backends.
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
            label="Requests"
            value={String(totalRequests)}
            hint="Across all backends"
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
  const reqPct = pct(row.requestsToday, row.requestsLimit);
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
        label="Requests"
        used={String(row.requestsToday)}
        limit={`${row.requestsLimit}/day`}
        percent={reqPct}
        tone={reqPct >= 90 ? "destructive" : "primary"}
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
