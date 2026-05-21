import { describe, test, expect } from "bun:test";
import { NotificationService } from "./notification-service";

describe("NotificationService", () => {
  test("emits a notification.send event", () => {
    const lines: string[] = [];
    const svc = new NotificationService({ notifier: { write: (l) => lines.push(l) } });
    const r = svc.send({ title: "hi", body: "body", workspaceId: "ws" });
    expect(r.ok).toBe(true);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.method).toBe("notification.send");
    expect(parsed.params.title).toBe("hi");
  });

  test("default constructor builds without DI", () => {
    expect(new NotificationService()).toBeInstanceOf(NotificationService);
  });
});
