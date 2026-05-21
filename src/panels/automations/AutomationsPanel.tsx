// ⌘⇧A — saved multi-step operation sequences from maverick.yaml.
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWorkbench } from "@/state/store";
import { configLoad, automationRun } from "@/lib/tauri";
import type { Automation } from "@/lib/ipc";
import AutomationBuilder from "./AutomationBuilder";
import AutomationRunner from "./AutomationRunner";
import { cn } from "@/lib/utils";

export default function AutomationsPanel() {
  const activeProject = useWorkbench((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    return s.projects.find((p) => p.id === ws?.projectId);
  });
  const activeWorkspaceId = useWorkbench((s) => s.activeWorkspaceId);

  const [automations, setAutomations] = useState<Automation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reduce = useReducedMotion();

  const refresh = useCallback(async () => {
    if (!activeProject) return;
    try {
      const cfg = await configLoad(activeProject.path);
      setAutomations(cfg.automations ?? []);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [activeProject]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = useCallback(
    async (name: string) => {
      if (!activeWorkspaceId) return;
      setRunning(name);
      try {
        await automationRun(name, activeWorkspaceId);
      } catch (e) {
        setError(String(e));
      } finally {
        setRunning(null);
      }
    },
    [activeWorkspaceId]
  );

  const upsert = useCallback(
    (next: Automation) => {
      setAutomations((curr) => {
        const idx = curr.findIndex((a) => a.name === next.name);
        if (idx >= 0) {
          const out = [...curr];
          out[idx] = next;
          return out;
        }
        return [...curr, next];
      });
      // Persistence to maverick.yaml is handled by sidecar; v0.1 keeps it in-memory if backend command missing.
    },
    []
  );

  const selectedAutomation = useMemo(
    () => automations.find((a) => a.name === selected),
    [automations, selected]
  );

  return (
    <motion.div
      data-testid="automations-panel"
      initial={reduce ? false : { opacity: 0 }}
      animate={reduce ? undefined : { opacity: 1 }}
      transition={{ duration: 0.18 }}
      className="grid h-full w-full grid-cols-[260px_1fr] bg-background"
    >
      <div className="flex flex-col border-r border-border">
        <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Automations
          </span>
          <Button
            size="sm"
            variant="outline"
            data-testid="automation-new"
            onClick={() => {
              const fresh: Automation = {
                name: `new-automation-${automations.length + 1}`,
                trigger: "manual",
                steps: [],
              };
              upsert(fresh);
              setSelected(fresh.name);
            }}
          >
            <Plus className="h-3 w-3" /> New
          </Button>
        </div>
        {error && (
          <div className="px-3 py-1.5 text-[11px] text-destructive">{error}</div>
        )}
        <ScrollArea className="flex-1">
          {automations.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">
              No automations defined.
            </div>
          ) : (
            automations.map((a) => (
              <button
                key={a.name}
                type="button"
                onClick={() => setSelected(a.name)}
                data-testid="automation-item"
                className={cn(
                  "flex w-full items-center justify-between border-b border-border/40 px-3 py-1.5 text-left text-xs hover:bg-accent/10",
                  selected === a.name && "bg-accent/20"
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-foreground">{a.name}</div>
                  <Badge variant="outline">{a.trigger}</Badge>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={running === a.name || !activeWorkspaceId}
                  onClick={(e) => {
                    e.stopPropagation();
                    run(a.name);
                  }}
                  data-testid="automation-run"
                >
                  <Play className="h-3 w-3" />
                </Button>
              </button>
            ))
          )}
        </ScrollArea>
      </div>

      <div className="grid min-h-0 grid-rows-[1fr_220px]">
        {selectedAutomation ? (
          <AutomationBuilder
            automation={selectedAutomation}
            onChange={(next) => upsert(next)}
          />
        ) : (
          <div className="flex items-center justify-center text-xs text-muted-foreground">
            Select an automation to edit
          </div>
        )}
        <AutomationRunner running={running} automationName={selectedAutomation?.name} />
      </div>
    </motion.div>
  );
}
