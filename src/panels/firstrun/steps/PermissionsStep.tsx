import { useEffect, useState } from "react";
import { Bell, BellRing, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestNotificationPermission } from "@/lib/tauri";
import type { BootstrapStatus, NotificationPermission } from "@/lib/ipc";
import { cn } from "@/lib/utils";

interface Props {
  status: BootstrapStatus;
  onAdvance: () => void;
}

function StatePill({ state }: { state: NotificationPermission }) {
  const map = {
    default: { Icon: Bell, label: "Not yet asked", tone: "text-muted-foreground" },
    granted: { Icon: CheckCircle2, label: "On", tone: "text-success" },
    denied: { Icon: XCircle, label: "Off", tone: "text-destructive" },
    unavailable: { Icon: AlertCircle, label: "Unavailable on this platform", tone: "text-muted-foreground" },
  } as const;
  const { Icon, label, tone } = map[state];
  return (
    <span data-testid="perm-state" className={cn("inline-flex items-center gap-1 text-[11px]", tone)}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function GrantedCard() {
  return (
    <div
      data-testid="perm-granted-card"
      className="flex flex-col items-center gap-3 rounded-md border border-success/40 bg-success/5 px-4 py-6 text-center"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-success/15 text-success">
        <BellRing className="h-5 w-5" />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-medium text-foreground">You&apos;re all set</span>
        <span className="text-[11px] text-muted-foreground">
          We&apos;ll ping you when an agent finishes, needs input, or hits a quota limit.
        </span>
      </div>
    </div>
  );
}

export function PermissionsStep({ status, onAdvance }: Props) {
  const [perm, setPerm] = useState<NotificationPermission>(status.notificationPermission);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (perm !== "unavailable") return;
    const t = setTimeout(onAdvance, 800);
    return () => clearTimeout(t);
  }, [perm, onAdvance]);

  async function onAllow() {
    setPending(true);
    try {
      const next = await requestNotificationPermission();
      setPerm(next);
    } finally {
      setPending(false);
    }
  }

  return (
    <div data-testid="firstrun-step-permissions" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">Stay in the loop</h2>
        <p className="text-[12px] text-muted-foreground">
          Maverick can ping you when an agent finishes or needs your input — handy when
          you&apos;re bouncing between windows.
        </p>
      </div>

      {perm === "granted" ? (
        <GrantedCard />
      ) : (
        <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-3">
          <div className="flex flex-col gap-1">
            <span className="text-[12px] text-foreground">System notifications</span>
            <StatePill state={perm} />
          </div>
          <Button
            variant="default"
            size="sm"
            disabled={pending || perm === "unavailable"}
            onClick={() => void onAllow()}
          >
            Allow notifications
          </Button>
        </div>
      )}

      {perm === "denied" && (
        <p className="text-[11px] text-muted-foreground">
          You blocked notifications earlier. To turn them back on, open System Settings →
          Notifications → Maverick.
        </p>
      )}
    </div>
  );
}
