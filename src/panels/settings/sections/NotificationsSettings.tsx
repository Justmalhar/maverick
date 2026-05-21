// Per-event notification toggles.
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface Toggle {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
}

const DEFAULT_TOGGLES: Toggle[] = [
  { id: "agent.waiting", label: "Agent waiting for input", description: "Notify when an agent pauses for stdin.", enabled: true },
  { id: "agent.complete", label: "Agent task complete", description: "Summary when a task finishes.", enabled: true },
  { id: "agent.error", label: "Agent error / crash", description: "Red notification on failure.", enabled: true },
  { id: "build.result", label: "Build / test result", description: "Pass/fail notification when run scripts complete.", enabled: true },
  { id: "quota.warning", label: "Quota warning", description: "Notify at 80% and 100% of quota.", enabled: true },
];

export default function NotificationsSettings() {
  const [toggles, setToggles] = useState<Toggle[]>(DEFAULT_TOGGLES);

  const flip = (id: string) =>
    setToggles((curr) => curr.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)));

  return (
    <section data-testid="notifications-settings" className="space-y-3">
      <h3 className="text-sm font-medium text-foreground">Notifications</h3>
      <div className="space-y-1.5">
        {toggles.map((t) => (
          <div
            key={t.id}
            data-testid={`notif-${t.id}`}
            className="flex items-center justify-between rounded-sm border border-border bg-card/30 p-2"
          >
            <div>
              <div className="text-xs text-foreground">{t.label}</div>
              <div className="text-[10px] text-muted-foreground">{t.description}</div>
            </div>
            <Button
              size="sm"
              variant={t.enabled ? "default" : "outline"}
              onClick={() => flip(t.id)}
            >
              {t.enabled ? "On" : "Off"}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
