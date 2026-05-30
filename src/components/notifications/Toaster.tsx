import { useEffect, useState } from "react";
import { onNotificationSend } from "@/lib/tauri";
import { dispatchOsNotification } from "@/lib/os-notify";
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
 * App-global notification surface: renders in-app toasts and fires an OS-native
 * notification for every `notification:send` event coming from the sidecar.
 */
export function Toaster() {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);

  useEffect(() => {
    const unlisten = onNotificationSend((n: Notification) => {
      setToasts((prev) => [...prev, { id: n.id, title: n.title, body: n.body }].slice(-MAX_VISIBLE));
      void dispatchOsNotification(n.title, n.body);
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
