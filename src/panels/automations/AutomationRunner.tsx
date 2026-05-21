// Streaming step output with per-step status indicators.
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { StatusDot } from "@/components/ui/status-dot";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Props {
  running: string | null;
  automationName?: string;
}

interface StepEvent {
  automation: string;
  stepIndex: number;
  status: "running" | "ok" | "error";
  output?: string;
}

export default function AutomationRunner({ running, automationName }: Props) {
  const [events, setEvents] = useState<StepEvent[]>([]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<StepEvent>("automation:step", (event) => {
      if (automationName && event.payload.automation !== automationName) return;
      setEvents((curr) => [...curr, event.payload]);
    })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {
        /* event channel not registered — fine */
      });
    return () => {
      unlisten?.();
    };
  }, [automationName]);

  useEffect(() => {
    if (running) setEvents([]);
  }, [running]);

  return (
    <div
      data-testid="automation-runner"
      className="flex h-full w-full flex-col border-t border-border bg-card/30"
    >
      <div className="flex items-center gap-2 border-b border-border px-2 py-1">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Runner
        </span>
        {running && (
          <span className="flex items-center gap-1.5 text-[11px] text-foreground">
            <StatusDot variant="running" />
            {running}
          </span>
        )}
      </div>
      <ScrollArea className="flex-1">
        {events.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-muted-foreground">
            No runs yet.
          </div>
        ) : (
          events.map((ev, i) => (
            <div
              key={i}
              data-testid="runner-event"
              className="flex items-start gap-2 border-b border-border/30 px-3 py-1.5 font-mono text-[10px]"
            >
              <StatusDot
                variant={
                  ev.status === "running"
                    ? "running"
                    : ev.status === "ok"
                      ? "active"
                      : "error"
                }
                className="mt-1"
              />
              <div className="flex-1">
                <div className="text-foreground">step #{ev.stepIndex + 1}</div>
                {ev.output && (
                  <pre className="mt-0.5 whitespace-pre-wrap text-muted-foreground">
                    {ev.output}
                  </pre>
                )}
              </div>
            </div>
          ))
        )}
      </ScrollArea>
    </div>
  );
}
