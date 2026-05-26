import { useEffect, useState } from "react";
import { Bell, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
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
    granted: { Icon: CheckCircle2, label: "Granted", tone: "text-success" },
    denied: { Icon: XCircle, label: "Denied", tone: "text-destructive" },
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
        <h2 className="text-base font-semibold text-foreground">Notifications</h2>
        <p className="text-[12px] text-muted-foreground">
          Allow Maverick to notify you when agents finish, wait for input, or hit quota limits.
          You can change this later in System Settings.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-3">
        <div className="flex flex-col gap-1">
          <span className="text-[12px] text-foreground">OS notification permission</span>
          <StatePill state={perm} />
        </div>
        <Button
          variant="default"
          size="sm"
          disabled={pending || perm === "granted" || perm === "unavailable"}
          onClick={() => void onAllow()}
        >
          Allow notifications
        </Button>
      </div>

      {perm === "denied" && (
        <p className="text-[11px] text-muted-foreground">
          Notifications are denied. To enable, open System Settings → Notifications → Maverick.
        </p>
      )}
    </div>
  );
}
