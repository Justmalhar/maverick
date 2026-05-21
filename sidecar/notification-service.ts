import { emit, stdoutNotifier } from "./deps";
import type { Notifier } from "./types";

interface SendParams {
  title: string;
  body: string;
  workspaceId?: string;
}

export interface NotificationServiceOptions {
  notifier?: Notifier;
}

export class NotificationService {
  private notifier: Notifier;

  constructor(opts: NotificationServiceOptions = {}) {
    this.notifier = opts.notifier ?? stdoutNotifier;
  }

  send(params: SendParams): { ok: true } {
    emit(this.notifier, "notification.send", params);
    return { ok: true };
  }
}
