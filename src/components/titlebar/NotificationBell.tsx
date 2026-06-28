import { useEffect, useMemo, useState } from "react";
import { Bell, Check, CheckCheck, Trash2, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  notifyClear,
  notifyDelete,
  notifyList,
  notifyMarkAllRead,
  notifyMarkRead,
  onNotificationSend,
} from "@/lib/tauri";
import type { Notification } from "@/lib/ipc";
import { cn } from "@/lib/utils";

const MAX_LIST = 50;

export function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    notifyList(MAX_LIST)
      .then((list) => {
        if (cancelled) return;
        const fetched = Array.isArray(list) ? list : [];
        // Merge, don't replace: a live notification can arrive (and be prepended
        // below) before this initial fetch resolves — replacing would drop it.
        setItems((prev) => {
          const extras = prev.filter((p) => !fetched.some((f) => f.id === p.id));
          return [...extras, ...fetched].slice(0, MAX_LIST);
        });
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoaded(true);
      });
    const unlisten = onNotificationSend((n) => {
      setItems((prev) => [n, ...prev].slice(0, MAX_LIST));
    });
    return () => {
      cancelled = true;
      unlisten.then((u) => u()).catch(() => {});
    };
  }, []);

  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items]);

  async function markRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try {
      await notifyMarkRead(id);
    } catch {
      /* best-effort */
    }
  }

  async function markAll() {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await notifyMarkAllRead();
    } catch {
      /* best-effort */
    }
  }

  async function deleteOne(id: string) {
    setItems((prev) => prev.filter((n) => n.id !== id));
    try {
      await notifyDelete(id);
    } catch {
      /* best-effort */
    }
  }

  async function clearAll() {
    setItems([]);
    try {
      await notifyClear();
    } catch {
      /* best-effort */
    }
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="titlebar-notifications"
              aria-label={
                unreadCount === 0
                  ? "Notifications"
                  : `Notifications, ${unreadCount} unread`
              }
              className="no-drag relative flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground"
            >
              <Bell className="h-3.5 w-3.5" />
              {unreadCount > 0 && (
                <span
                  data-testid="titlebar-notifications-count"
                  className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold leading-none text-accent-foreground"
                >
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Notifications</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        alignOffset={-32}
        collisionPadding={8}
        className="w-80 max-w-[90vw] p-0"
        data-testid="notification-bell-popover"
      >
        <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Notifications
          </span>
          {items.length > 0 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={markAll}
                data-testid="notification-mark-all"
                className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <CheckCheck className="h-3 w-3" />
                Mark all read
              </button>
              <button
                type="button"
                onClick={clearAll}
                data-testid="notification-clear-all"
                className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
                Clear all
              </button>
            </div>
          )}
        </header>

        <ul className="max-h-80 overflow-y-auto py-1" data-testid="notification-list">
          {!loaded ? (
            <li className="px-3 py-4 text-center text-xs text-muted-foreground">
              Loading…
            </li>
          ) : items.length === 0 ? (
            <li
              data-testid="notification-empty"
              className="px-3 py-6 text-center text-xs text-muted-foreground"
            >
              You're all caught up.
            </li>
          ) : (
            items.map((n) => (
              <li
                key={n.id}
                data-testid={`notification-item-${n.id}`}
                className={cn(
                  "group relative cursor-default px-3 py-2 text-xs",
                  !n.read && "bg-accent/5"
                )}
              >
                <div className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                      n.read ? "bg-transparent" : "bg-accent"
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate font-medium text-foreground">{n.title}</p>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(n.createdAt * 1000), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                    {n.body && (
                      <p className="mt-0.5 line-clamp-2 text-muted-foreground">{n.body}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {!n.read && (
                      <button
                        type="button"
                        onClick={() => markRead(n.id)}
                        aria-label="Mark as read"
                        data-testid={`notification-mark-${n.id}`}
                        className="rounded-sm p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteOne(n.id)}
                      aria-label="Delete notification"
                      data-testid={`notification-delete-${n.id}`}
                      className="rounded-sm p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </li>
            ))
          )}
        </ul>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
