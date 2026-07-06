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
    await post(
      port,
      { hook_event_name: "Notification", notification_type: "idle_prompt" },
      { "X-Maverick-Token": "tok" }
    );
    expect(notif.calls[0].workspaceId).toBeNull();
    expect(notif.calls[0].type).toBe("agent.attention");
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

  it("routes a tokened POST to /autopilot-trigger into onAutopilotTrigger", async () => {
    const notif = fakeNotifications();
    const calls: string[] = [];
    server = new HookServer({
      notifications: notif,
      token: "tok",
      onAutopilotTrigger: async (id) => {
        calls.push(id);
        return { ok: true };
      },
    });
    await server.start();
    const { port } = server.endpoint();
    const res = await fetch(`http://127.0.0.1:${port}/autopilot-trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Maverick-Token": "tok" },
      body: JSON.stringify({ id: "autopilot_1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls).toEqual(["autopilot_1"]);
  });

  it("returns 404 for /autopilot-trigger when no handler is configured", async () => {
    const notif = fakeNotifications();
    server = new HookServer({ notifications: notif, token: "tok" });
    await server.start();
    const { port } = server.endpoint();
    const res = await fetch(`http://127.0.0.1:${port}/autopilot-trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Maverick-Token": "tok" },
      body: JSON.stringify({ id: "autopilot_1" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 for /autopilot-trigger with malformed JSON or a missing id", async () => {
    const notif = fakeNotifications();
    server = new HookServer({
      notifications: notif,
      token: "tok",
      onAutopilotTrigger: async () => ({ ok: true }),
    });
    await server.start();
    const { port } = server.endpoint();
    const badJson = await fetch(`http://127.0.0.1:${port}/autopilot-trigger`, {
      method: "POST",
      headers: { "X-Maverick-Token": "tok" },
      body: "{not json",
    });
    expect(badJson.status).toBe(400);
    const missingId = await fetch(`http://127.0.0.1:${port}/autopilot-trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Maverick-Token": "tok" },
      body: JSON.stringify({}),
    });
    expect(missingId.status).toBe(400);
  });

  it("rejects an untokened POST to /autopilot-trigger with 401", async () => {
    const notif = fakeNotifications();
    server = new HookServer({
      notifications: notif,
      token: "tok",
      onAutopilotTrigger: async () => ({ ok: true }),
    });
    await server.start();
    const { port } = server.endpoint();
    const res = await fetch(`http://127.0.0.1:${port}/autopilot-trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Maverick-Token": "nope" },
      body: JSON.stringify({ id: "a" }),
    });
    expect(res.status).toBe(401);
  });
});
