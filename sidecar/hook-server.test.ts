import { describe, it, expect, afterEach } from "bun:test";
import { HookServer } from "./hook-server";

function fakeNotifications() {
  const calls: any[] = [];
  return { calls, send: (p: any) => { calls.push(p); return { ok: true } as const; } };
}

let server: HookServer | null = null;
afterEach(() => { server?.stop(); server = null; });

async function post(port: number, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}/agent-hook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("HookServer", () => {
  it("sends a notification for a valid tokened idle_prompt with workspace header", async () => {
    const notif = fakeNotifications();
    server = new HookServer({ notifications: notif, token: "tok" });
    await server.start();
    const { port } = server.endpoint();
    const res = await post(
      port,
      { hook_event_name: "Notification", notification_type: "idle_prompt", message: "hi" },
      { "X-Maverick-Token": "tok", "X-Maverick-Workspace": "ws_9" }
    );
    expect(res.status).toBe(200);
    expect(notif.calls).toEqual([
      { workspaceId: "ws_9", type: "agent.attention", title: "Agent needs input", body: "hi" },
    ]);
  });

  it("rejects a bad token with 401 and sends nothing", async () => {
    const notif = fakeNotifications();
    server = new HookServer({ notifications: notif, token: "tok" });
    await server.start();
    const { port } = server.endpoint();
    const res = await post(port, { hook_event_name: "Stop" }, { "X-Maverick-Token": "nope" });
    expect(res.status).toBe(401);
    expect(notif.calls).toHaveLength(0);
  });

  it("fails open to workspaceId null when the header is absent", async () => {
    const notif = fakeNotifications();
    server = new HookServer({ notifications: notif, token: "tok" });
    await server.start();
    const { port } = server.endpoint();
    await post(port, { hook_event_name: "Stop" }, { "X-Maverick-Token": "tok" });
    expect(notif.calls[0].workspaceId).toBeNull();
    expect(notif.calls[0].type).toBe("agent.done");
  });

  it("ignores unmapped events without sending", async () => {
    const notif = fakeNotifications();
    server = new HookServer({ notifications: notif, token: "tok" });
    await server.start();
    const { port } = server.endpoint();
    const res = await post(port, { hook_event_name: "SessionStart" }, { "X-Maverick-Token": "tok" });
    expect(res.status).toBe(200);
    expect(notif.calls).toHaveLength(0);
  });

  it("returns 400 on malformed JSON and 404 on other routes", async () => {
    const notif = fakeNotifications();
    server = new HookServer({ notifications: notif, token: "tok" });
    await server.start();
    const { port } = server.endpoint();
    const bad = await fetch(`http://127.0.0.1:${port}/agent-hook`, {
      method: "POST",
      headers: { "X-Maverick-Token": "tok" },
      body: "{not json",
    });
    expect(bad.status).toBe(400);
    const other = await fetch(`http://127.0.0.1:${port}/nope`, { headers: { "X-Maverick-Token": "tok" } });
    expect(other.status).toBe(404);
  });

  it("generates a token when none is supplied and is idempotent on start", async () => {
    const notif = fakeNotifications();
    server = new HookServer({ notifications: notif });
    await server.start();
    const first = server.endpoint();
    await server.start();
    expect(server.endpoint()).toEqual(first);
    expect(first.token.length).toBeGreaterThanOrEqual(16);
  });
});
