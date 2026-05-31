import { useEffect, useRef, useState } from "react";
import { onNotificationSend } from "@/lib/tauri";
import { dispatchOsNotification } from "@/lib/os-notify";
import { routeNotification } from "@/lib/notification-route";
import { useWindowFocus } from "@/hooks/useWindowFocus";
import { useWorkbench } from "@/state/store";
import type { Notification } from "@/lib/ipc";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";

interface ActiveToast {
  id: string;
  title: string;
  body: string;
}

const TOAST_DURATION = 6000;
const MAX_VISIBLE = 4;

/**
 * App-global transient notification surface. For every `notification:send` from
 * the sidecar it applies the focus/visibility routing policy: an OS-native
 * notification when the app is away, an in-app toast when focused but looking at
 * a different workspace, and silence when the user is already on the relevant
 * tab. History (NotificationBell) is updated independently and is unaffected.
 */
export function Toaster() {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const { focused, visible } = useWindowFocus();
  const activeWorkspaceId = useWorkbench((s) => s.activeWorkspaceId);

  // Routing reads live focus/visibility/active state inside an event callback
  // that is bound once, so keep a ref the listener can read without re-binding.
  const routeStateRef = useRef({ focused, visible, activeWorkspaceId });
  routeStateRef.current = { focused, visible, activeWorkspaceId };

  useEffect(() => {
    const unlisten = onNotificationSend((n: Notification) => {
      const { focused: f, visible: v, activeWorkspaceId: a } = routeStateRef.current;
      const action = routeNotification({
        notification: n,
        focused: f,
        visible: v,
        activeWorkspaceId: a,
      });
      if (action === "os") {
        void dispatchOsNotification(n.title, n.body);
        return;
      }
      if (action === "toast") {
        setToasts((prev) =>
          [...prev, { id: n.id, title: n.title, body: n.body }].slice(-MAX_VISIBLE)
        );
      }
    });
    return () => {
      unlisten.then((u) => u()).catch(() => {});
    };
  }, []);

  function dismiss(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <ToastProvider duration={TOAST_DURATION} swipeDirection="right">
      {toasts.map((t) => (
        <Toast
          key={t.id}
          data-testid={`toast-${t.id}`}
          onOpenChange={(open) => {
            if (!open) dismiss(t.id);
          }}
        >
          <div className="flex-1 pr-4">
            <ToastTitle>{t.title}</ToastTitle>
            {t.body && <ToastDescription>{t.body}</ToastDescription>}
          </div>
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
