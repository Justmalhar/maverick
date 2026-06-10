// Usage Manager — daily token consumption per backend, read from each CLI's
// own session logs by the sidecar (usage.summary RPC). Costs are client-side
// estimates derived from the real token counts; Maverick never bills.
import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Activity, Coins, Cpu, DollarSign, Gauge, Zap } from "lucide-react";
import { useWorkbench } from "@/state/store";
import { usageSummary } from "@/lib/tauri";
import { estimateCost, formatTokens } from "@/lib/context-usage";
import { brandFor } from "@/lib/backend-brand";
import type { BackendTokenUsage } from "@/lib/ipc";

// Dashboard scope for v0.1 — the only backends with (or pending) log-based
// tracking. Mirrors TRACKED_BACKENDS in sidecar/usage-tracker.ts.
const TRACKED_BACKENDS = ["claude-code", "codex", "antigravity"] as const;

// External CLIs append to their logs without notifying Maverick; poll slowly.
const REFRESH_INTERVAL_MS = 30_000;

function zeroUsage(backend: string): BackendTokenUsage {
  return {
    backend,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    sessions: 0,
  };
}

export default function UsagePanel() {
  const reduce = useReducedMotion();
  const workspaces = useWorkbench((s) => s.workspaces);
  const [backendUsage, setBackendUsage] = useState<Record<string, BackendTokenUsage>>({});

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const summary = await usageSummary();
        if (cancelled) return;
        const byBackend: Record<string, BackendTokenUsage> = {};
        for (const b of summary.backends) byBackend[b.backend] = b;
        setBackendUsage(byBackend);
      } catch {
        /* sidecar unavailable — keep last known figures */
      }
    }
    void refresh();
    function onUpdated() {
      void refresh();
    }
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    window.addEventListener("maverick:context:updated", onUpdated);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("maverick:context:updated", onUpdated);
    };
  }, []);

  const rows = useMemo(
    () => TRACKED_BACKENDS.map((name) => backendUsage[name] ?? zeroUsage(name)),
    [backendUsage]
  );

  const totalTokens = rows.reduce((sum, r) => sum + r.totalTokens, 0);
  const totalSessions = rows.reduce((sum, r) => sum + r.sessions, 0);
  const totalCost = rows.reduce(
    (sum, r) => sum + estimateCost(r.totalTokens, r.backend),
    0
  );

  return (
    <motion.div
      data-testid="usage-panel"
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="w-full bg-editor"
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
              Today&apos;s tokens and sessions, read from each CLI&apos;s own logs.
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
            label="Sessions today"
            value={String(totalSessions)}
            hint="CLI sessions with token usage"
          />
          <StatCard
            icon={DollarSign}
            label="Est. cost"
            value={`$${totalCost.toFixed(2)}`}
            hint="Estimate from token counts · resets daily"
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
              <BackendRow key={row.backend} row={row} />
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
                Figures come from each backend&apos;s own session logs — Maverick
                does not bill you, only surfaces what your CLIs report.
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
      data-testid={`usage-stat-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
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

function BackendRow({ row }: { row: BackendTokenUsage }) {
  const brand = brandFor(row.backend);
  const Icon = brand?.Icon;
  const cost = estimateCost(row.totalTokens, row.backend);
  return (
    <div
      className="flex flex-col gap-3 px-4 py-3.5"
      data-testid={`usage-backend-${row.backend}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {Icon && (
            <span
              className="flex h-6 w-6 items-center justify-center"
              data-testid={`usage-backend-icon-${row.backend}`}
            >
              <Icon size={18} />
            </span>
          )}
          <span className="font-mono text-[13px] text-foreground">
            {brand?.label ?? row.backend}
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          ${cost.toFixed(2)} est. today
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <TokenStat label="Total" value={formatTokens(row.totalTokens)} emphasis />
        <TokenStat label="Input" value={formatTokens(row.inputTokens)} />
        <TokenStat label="Output" value={formatTokens(row.outputTokens)} />
        <TokenStat
          label="Cache"
          value={formatTokens(row.cacheReadTokens + row.cacheCreationTokens)}
        />
        <TokenStat label="Sessions" value={String(row.sessions)} />
      </div>
    </div>
  );
}

function TokenStat({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-secondary/50 px-2.5 py-1.5">
      <span className="text-[10px] uppercase tracking-wider text-sidebar-section">
        {label}
      </span>
      <span
        className={
          emphasis
            ? "font-mono text-sm font-semibold text-foreground"
            : "font-mono text-sm text-muted-foreground"
        }
      >
        {value}
      </span>
    </div>
  );
}
