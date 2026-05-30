import { emit, stdoutNotifier } from "./deps";
import type { Notifier, Notification } from "./types";
import type { SQLiteStore } from "./sqlite-store";

interface SendParams {
  title: string;
  body: string;
  workspaceId?: string;
  type?: string;
}

interface ListParams {
  limit?: number;
  unreadOnly?: boolean;
}

export interface NotificationServiceOptions {
  notifier?: Notifier;
  store?: SQLiteStore;
}

export class NotificationService {
  private notifier: Notifier;
  private store: SQLiteStore | undefined;

  constructor(opts: NotificationServiceOptions = {}) {
    this.notifier = opts.notifier ?? stdoutNotifier;
    this.store = opts.store;
  }

  send(params: SendParams): Notification | { ok: true } {
    if (this.store) {
      const saved = this.store.notificationInsert({
        workspaceId: params.workspaceId ?? null,
        type: params.type ?? "info",
        title: params.title,
        body: params.body,
      });
      emit(this.notifier, "notification.send", saved);
      return saved;
    }
    emit(this.notifier, "notification.send", params);
    return { ok: true };
  }

  list(params: ListParams = {}): Notification[] {
    if (!this.store) return [];
    return this.store.notificationList(params);
  }

  markRead(params: { id: string }): { ok: true } {
    if (!this.store) return { ok: true };
    return this.store.notificationMarkRead(params);
  }

  markAllRead(): { ok: true } {
    if (!this.store) return { ok: true };
    return this.store.notificationMarkAllRead();
  }

  unreadCount(): number {
    if (!this.store) return 0;
    return this.store.notificationUnreadCount();
  }
}
