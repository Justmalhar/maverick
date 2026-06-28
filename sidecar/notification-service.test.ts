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

  test("delete and clear are no-ops without a store", () => {
    const svc = new NotificationService({ notifier: { write: () => {} } });
    expect(svc.delete({ id: "n1" }).ok).toBe(true);
    expect(svc.clear().ok).toBe(true);
  });

  test("delete and clear delegate to the store", () => {
    const calls: string[] = [];
    const store = {
      notificationDelete: (input: { id: string }) => {
        calls.push(`delete:${input.id}`);
        return { ok: true } as const;
      },
      notificationClearAll: () => {
        calls.push("clear");
        return { ok: true } as const;
      },
    };
    const svc = new NotificationService({
      notifier: { write: () => {} },
      // The service only touches the two methods exercised here.
      store: store as unknown as ConstructorParameters<typeof NotificationService>[0]["store"],
    });
    expect(svc.delete({ id: "n1" }).ok).toBe(true);
    expect(svc.clear().ok).toBe(true);
    expect(calls).toEqual(["delete:n1", "clear"]);
  });
});
