// Autopilots: recurring/webhook/manual-triggered background agent runs.
import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Plus, Play, Pencil, RefreshCw, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { useWorkbench } from "@/state/store";
import {
  autopilotList,
  autopilotUpsert,
  autopilotDelete,
  autopilotRunNow,
  autopilotWebhookInfo,
} from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { Autopilot } from "@/lib/ipc";
import ProjectFilterTabs from "@/panels/kanban/ProjectFilterTabs";
import AutopilotDialog from "./AutopilotDialog";

const LAST_STATUS_DOT: Record<Autopilot["lastStatus"], string> = {
  never: "bg-muted-foreground/40",
  ok: "bg-success",
  error: "bg-destructive",
};

function AutopilotCard({
  autopilot,
  onEdit,
  onToggle,
  onRunNow,
  running,
}: {
  autopilot: Autopilot;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
  onRunNow: () => void;
  running: boolean;
}) {
  return (
    <li
      data-testid={`autopilot-card-${autopilot.id}`}
      className="flex items-center gap-2.5 rounded-md border border-border/50 bg-card px-3 py-2 text-xs"
    >
      <span
        className={cn("h-2 w-2 shrink-0 rounded-full", LAST_STATUS_DOT[autopilot.lastStatus])}
        title={`Last run: ${autopilot.lastStatus}${autopilot.lastError ? ` — ${autopilot.lastError}` : ""}`}
        data-testid={`autopilot-status-${autopilot.id}`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium text-foreground">{autopilot.name}</span>
        <span className="truncate text-[11px] text-muted-foreground">
          {autopilot.backend || "default backend"}
          {autopilot.intervalMinutes != null
            ? ` · every ${autopilot.intervalMinutes}m`
            : " · manual / webhook only"}
        </span>
      </div>
      <Switch
        checked={autopilot.enabled}
        onCheckedChange={onToggle}
        data-testid={`autopilot-toggle-${autopilot.id}`}
        aria-label={`${autopilot.enabled ? "Disable" : "Enable"} ${autopilot.name}`}
      />
      <Button
        size="sm"
        variant="outline"
        className="h-6 gap-1 px-2 text-[11px]"
        onClick={onRunNow}
        disabled={running}
        data-testid={`autopilot-run-${autopilot.id}`}
      >
        <Play className="h-2.5 w-2.5" />
        {running ? "Running…" : "Run now"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 w-6 p-0"
        onClick={onEdit}
        aria-label={`Edit ${autopilot.name}`}
        data-testid={`autopilot-edit-${autopilot.id}`}
      >
        <Pencil className="h-3 w-3" />
      </Button>
    </li>
  );
}

export default function AutopilotPanel() {
  const backends = useWorkbench((s) => s.backends);
  const projects = useWorkbench((s) => s.projects);
  const [filterProjectId, setFilterProjectId] = useState<string | null>(null);
  const [autopilots, setAutopilots] = useState<Autopilot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogAutopilot, setDialogAutopilot] = useState<Partial<Autopilot> | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [webhookInfo, setWebhookInfo] = useState<{ url: string; token: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAutopilots(await autopilotList(filterProjectId ?? ""));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [filterProjectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const targetProjectId = filterProjectId ?? projects[0]?.id ?? null;

  function openNew() {
    if (!targetProjectId) return;
    setDialogAutopilot({ projectId: targetProjectId });
    setDialogOpen(true);
  }

  function openEdit(a: Autopilot) {
    setDialogAutopilot(a);
    setDialogOpen(true);
  }

  async function handleSubmit(a: Partial<Autopilot>) {
    await autopilotUpsert(a);
    setDialogOpen(false);
    await refresh();
  }

  async function handleDelete(id: string) {
    await autopilotDelete(id);
    setDialogOpen(false);
    await refresh();
  }

  async function handleToggle(a: Autopilot, enabled: boolean) {
    await autopilotUpsert({ ...a, enabled });
    await refresh();
  }

  async function handleRunNow(id: string) {
    setRunningIds((prev) => new Set(prev).add(id));
    try {
      const result = await autopilotRunNow(id);
      // refresh() clears any prior error, so a failed run's message must be
      // set after it — otherwise the reload immediately wipes it.
      await refresh();
      if (!result.ok) setError(result.error ?? "Run failed");
    } finally {
      setRunningIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function revealWebhookInfo() {
    try {
      setWebhookInfo(await autopilotWebhookInfo());
    } catch (e) {
      setError(String(e));
    }
  }

  const reduce = useReducedMotion();

  return (
    <motion.div
      data-testid="automations-panel"
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      className="flex h-full w-full flex-col bg-background"
    >
      <ProjectFilterTabs filterProjectId={filterProjectId} onFilterChange={setFilterProjectId} />

      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Autopilots</span>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={revealWebhookInfo} data-testid="autopilot-webhook-info">
            <Webhook className="h-3 w-3" />
            Webhook
          </Button>
          <Button size="sm" variant="ghost" onClick={refresh} data-testid="autopilot-refresh">
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={openNew}
            disabled={!targetProjectId}
            title={!targetProjectId ? "Add a project first" : undefined}
            data-testid="autopilot-new"
          >
            <Plus className="h-3 w-3" />
            New autopilot
          </Button>
        </div>
      </div>

      {webhookInfo && (
        <div data-testid="autopilot-webhook-details" className="space-y-1 border-b border-border px-3 py-2 text-[11px]">
          <p className="text-muted-foreground">
            POST an autopilot's id to trigger it (loopback only — not internet-reachable):
          </p>
          <code className="block truncate text-foreground">{webhookInfo.url}</code>
          <p className="text-muted-foreground">
            Header <code>X-Maverick-Token: {webhookInfo.token}</code>, body <code>{"{ \"id\": \"...\" }"}</code>
          </p>
        </div>
      )}

      {error && <div className="px-3 py-1.5 text-[11px] text-destructive">{error}</div>}
      {loading && <div className="px-3 py-1.5 text-[11px] text-muted-foreground">Loading…</div>}

      <ScrollArea className="flex-1">
        {autopilots.length === 0 && !loading ? (
          <div data-testid="autopilot-empty" className="px-3 py-2 text-[11px] text-muted-foreground">
            No autopilots configured.
          </div>
        ) : (
          <ul className="space-y-1.5 p-2">
            {autopilots.map((a) => (
              <AutopilotCard
                key={a.id}
                autopilot={a}
                onEdit={() => openEdit(a)}
                onToggle={(enabled) => handleToggle(a, enabled)}
                onRunNow={() => handleRunNow(a.id)}
                running={runningIds.has(a.id)}
              />
            ))}
          </ul>
        )}
      </ScrollArea>

      <AutopilotDialog
        open={dialogOpen}
        autopilot={dialogAutopilot ?? undefined}
        backends={backends}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        onDelete={handleDelete}
      />
    </motion.div>
  );
}
