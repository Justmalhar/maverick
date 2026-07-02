# Hook-Driven Agent Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the PTY BEL-sniffing notification heuristic with real Claude Code lifecycle hooks delivered to a loopback HTTP receiver in the sidecar, so OS notifications fire only when Claude is genuinely waiting for input, finishes a turn, or fails.

**Architecture:** The sidecar runs a token-gated loopback HTTP server. Each Claude workspace is launched with `claude --settings <maverick-managed-file>` whose hooks POST `Notification`/`Stop`/`StopFailure` events to that server with an `X-Maverick-Workspace` header. The server maps events to `NotificationService.send`, which emits the existing `notification.send` event the Toaster/NotificationBell already render. The frontend byte-stream→notify bridge is deleted; the byte stream keeps driving only the cosmetic working/idle pill.

**Tech Stack:** Bun (`Bun.serve`), TypeScript, Zod (RPC schemas), Vitest (frontend), `bun test` (sidecar), Rust/Tauri (thin command passthrough), React/Zustand.

**Spec:** `docs/superpowers/specs/2026-07-02-hook-driven-notifications-design.md`

---

## File Structure

**Create:**
- `sidecar/hook-events.ts` — pure mapper: Claude hook JSON → `{ type, title, body } | null`.
- `sidecar/hook-events.test.ts`
- `sidecar/claude-hooks.ts` — hooks-settings-file path + JSON builder + writer.
- `sidecar/claude-hooks.test.ts`
- `sidecar/hook-server.ts` — `HookServer` (Bun.serve loopback + token + POST /agent-hook).
- `sidecar/hook-server.test.ts`
- `src-tauri/src/commands/hooks.rs` — `hooks_claude_settings_path` command.

**Modify:**
- `sidecar/rpc-handlers.ts` — own a `HookServer`; add `hooks.claudeSettingsPath` RPC.
- `sidecar/rpc-handlers.test.ts` — cover the new RPC.
- `src-tauri/src/commands/mod.rs` — `pub mod hooks;` + re-export.
- `src-tauri/src/lib.rs` — register `hooks_claude_settings_path` in the handler list.
- `src/lib/tauri.ts` — `hooksClaudeSettingsPath()` binding.
- `src/lib/tauri.test.ts` — cover the binding.
- `src/hooks/useLaunchSpec.ts` — inject `--settings <path>` for Claude launches.
- `src/hooks/useLaunchSpec.test.ts` (or existing) — cover injection.
- `src/hooks/useAgentStatus.ts` — remove BEL→attention.
- `src/hooks/useAgentStatus.test.ts` — update.
- `src/components/workbench/Workbench.tsx` — drop `useAgentNotifications`.

**Delete:**
- `src/hooks/useAgentNotifications.ts`
- `src/hooks/useAgentNotifications.test.ts`

---

## Task 1: Claude hook event → notification mapper (pure)

**Files:**
- Create: `sidecar/hook-events.ts`
- Test: `sidecar/hook-events.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { mapClaudeHookEvent } from "./hook-events";

describe("mapClaudeHookEvent", () => {
  it("maps permission_prompt Notification to agent.attention", () => {
    const out = mapClaudeHookEvent({
      hook_event_name: "Notification",
      notification_type: "permission_prompt",
      message: "Claude needs permission to run npm test",
    });
    expect(out).toEqual({
      type: "agent.attention",
      title: "Agent needs input",
      body: "Claude needs permission to run npm test",
    });
  });

  it("maps idle_prompt Notification to agent.attention with a default body", () => {
    const out = mapClaudeHookEvent({
      hook_event_name: "Notification",
      notification_type: "idle_prompt",
    });
    expect(out).toEqual({
      type: "agent.attention",
      title: "Agent needs input",
      body: "Claude is waiting for your input",
    });
  });

  it("maps Stop to agent.done", () => {
    expect(mapClaudeHookEvent({ hook_event_name: "Stop" })).toEqual({
      type: "agent.done",
      title: "Agent finished",
      body: "Claude finished its task",
    });
  });

  it("maps StopFailure to agent.error", () => {
    expect(mapClaudeHookEvent({ hook_event_name: "StopFailure" })).toEqual({
      type: "agent.error",
      title: "Agent error",
      body: "Claude exited with an error",
    });
  });

  it("ignores Notification types that are not attention-worthy", () => {
    expect(
      mapClaudeHookEvent({ hook_event_name: "Notification", notification_type: "auth_success" })
    ).toBeNull();
  });

  it("ignores unknown / malformed events", () => {
    expect(mapClaudeHookEvent({})).toBeNull();
    expect(mapClaudeHookEvent({ hook_event_name: "SessionStart" })).toBeNull();
    expect(mapClaudeHookEvent(null)).toBeNull();
    expect(mapClaudeHookEvent("nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && bun test hook-events.test.ts`
Expected: FAIL — `mapClaudeHookEvent` is not defined / module missing.

- [ ] **Step 3: Write the implementation**

```ts
// sidecar/hook-events.ts

/** The transient notification a Claude hook event should raise, or null to ignore. */
export interface MappedHookNotification {
  type: string;
  title: string;
  body: string;
}

// Only these Notification subtypes mean "the user is genuinely blocked": a
// permission dialog or an idle prompt awaiting the next instruction. auth/
// elicitation chatter is deliberately ignored so we never spam.
const ATTENTION_NOTIFICATION_TYPES = new Set(["permission_prompt", "idle_prompt"]);

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Map a Claude Code hook payload (parsed JSON body of a `/agent-hook` POST) to
 * the notification it should raise, or null when the event is not worth
 * interrupting the user. Pure and total: never throws on malformed input.
 */
export function mapClaudeHookEvent(payload: unknown): MappedHookNotification | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const event = asString(p.hook_event_name);
  if (!event) return null;

  if (event === "Notification") {
    const kind = asString(p.notification_type);
    if (!kind || !ATTENTION_NOTIFICATION_TYPES.has(kind)) return null;
    return {
      type: "agent.attention",
      title: "Agent needs input",
      body: asString(p.message) ?? "Claude is waiting for your input",
    };
  }
  if (event === "Stop") {
    return { type: "agent.done", title: "Agent finished", body: "Claude finished its task" };
  }
  if (event === "StopFailure") {
    return { type: "agent.error", title: "Agent error", body: "Claude exited with an error" };
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && bun test hook-events.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add sidecar/hook-events.ts sidecar/hook-events.test.ts
git commit -m "feat(sidecar): map Claude hook events to notifications"
```

---

## Task 2: Per-workspace Claude hooks settings file

**Files:**
- Create: `sidecar/claude-hooks.ts`
- Test: `sidecar/claude-hooks.test.ts`

**Interface produced (used by Tasks 3–4):**
- `buildClaudeHooksSettings(opts: { port: number; token: string }): object` — the settings JSON.
- `claudeHooksDir(): string` — platform data dir `.../maverick/claude-hooks`.
- `writeClaudeHooksFile(opts: { workspaceId: string; port: number; token: string; dir?: string }): string` — writes `<dir>/<workspaceId>.json`, returns the absolute path.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "bun:test";
import { rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { buildClaudeHooksSettings, writeClaudeHooksFile } from "./claude-hooks";

const dir = join(tmpdir(), "mv-claude-hooks-test");
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("buildClaudeHooksSettings", () => {
  it("wires Notification/Stop/StopFailure http hooks with token + workspace header", () => {
    const s = buildClaudeHooksSettings({ port: 51234, token: "secret-abc" }) as any;
    expect(s.env.MAVERICK_WS).toBe("${MAVERICK_WS}"); // placeholder replaced per-file by writer
    for (const ev of ["Notification", "Stop", "StopFailure"]) {
      const hook = s.hooks[ev][0].hooks[0];
      expect(hook.type).toBe("http");
      expect(hook.url).toBe("http://127.0.0.1:51234/agent-hook");
      expect(hook.headers["X-Maverick-Token"]).toBe("secret-abc");
      expect(hook.headers["X-Maverick-Workspace"]).toBe("${MAVERICK_WS}");
      expect(hook.allowedEnvVars).toEqual(["MAVERICK_WS"]);
    }
  });
});

describe("writeClaudeHooksFile", () => {
  it("writes <workspaceId>.json with the workspace id in env and returns the path", () => {
    const path = writeClaudeHooksFile({ workspaceId: "ws_1", port: 51234, token: "t", dir });
    expect(path).toBe(join(dir, "ws_1.json"));
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed.env.MAVERICK_WS).toBe("ws_1");
    expect(parsed.hooks.Notification[0].hooks[0].headers["X-Maverick-Workspace"]).toBe(
      "${MAVERICK_WS}"
    );
  });

  it("overwrites an existing file idempotently", () => {
    const a = writeClaudeHooksFile({ workspaceId: "ws_1", port: 1, token: "t", dir });
    const b = writeClaudeHooksFile({ workspaceId: "ws_1", port: 2, token: "t", dir });
    expect(a).toBe(b);
    expect(JSON.parse(readFileSync(b, "utf8")).hooks.Stop[0].hooks[0].url).toContain(":2/");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && bun test claude-hooks.test.ts`
Expected: FAIL — module/functions missing.

- [ ] **Step 3: Write the implementation**

```ts
// sidecar/claude-hooks.ts
import { homedir, platform } from "os";
import { join } from "path";
import { mkdirSync, writeFileSync } from "fs";

const WS_ENV = "MAVERICK_WS";
const WS_PLACEHOLDER = "${" + WS_ENV + "}";

/** Platform data dir for Maverick-managed Claude hook settings files. */
export function claudeHooksDir(): string {
  const p = platform();
  if (p === "darwin") return join(homedir(), "Library", "Application Support", "maverick", "claude-hooks");
  if (p === "win32") return join(process.env.APPDATA ?? homedir(), "maverick", "claude-hooks");
  return join(homedir(), ".local", "share", "maverick", "claude-hooks");
}

function httpHook(port: number, token: string) {
  return {
    hooks: [
      {
        type: "http",
        url: `http://127.0.0.1:${port}/agent-hook`,
        headers: { "X-Maverick-Token": token, "X-Maverick-Workspace": WS_PLACEHOLDER },
        allowedEnvVars: [WS_ENV],
        timeout: 5,
      },
    ],
  };
}

/**
 * The additional-settings JSON Claude loads via `--settings`. Hooks POST each
 * lifecycle event to the sidecar's loopback receiver; the ${MAVERICK_WS} header
 * is interpolated from the per-file `env` block written by writeClaudeHooksFile.
 */
export function buildClaudeHooksSettings(opts: { port: number; token: string }): object {
  const hook = () => [httpHook(opts.port, opts.token)];
  return {
    hooks: { Notification: hook(), Stop: hook(), StopFailure: hook() },
    env: { [WS_ENV]: WS_PLACEHOLDER },
  };
}

/** Write the per-workspace settings file and return its absolute path. */
export function writeClaudeHooksFile(opts: {
  workspaceId: string;
  port: number;
  token: string;
  dir?: string;
}): string {
  const dir = opts.dir ?? claudeHooksDir();
  mkdirSync(dir, { recursive: true });
  const base = buildClaudeHooksSettings({ port: opts.port, token: opts.token }) as {
    env: Record<string, string>;
  };
  const settings = { ...base, env: { ...base.env, [WS_ENV]: opts.workspaceId } };
  const path = join(dir, `${opts.workspaceId}.json`);
  writeFileSync(path, JSON.stringify(settings, null, 2), "utf8");
  return path;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && bun test claude-hooks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sidecar/claude-hooks.ts sidecar/claude-hooks.test.ts
git commit -m "feat(sidecar): per-workspace Claude hooks settings file writer"
```

---

## Task 3: Loopback hook HTTP server

**Files:**
- Create: `sidecar/hook-server.ts`
- Test: `sidecar/hook-server.test.ts`

**Interface produced (used by Task 4):**
- `class HookServer` constructed with `{ notifications: Pick<NotificationService, "send">; token?: string }`.
- `await start(): Promise<void>` — binds `Bun.serve` to `127.0.0.1:0`; idempotent.
- `endpoint(): { port: number; token: string }` — throws if not started.
- `stop(): void`.
- Behavior: `POST /agent-hook` requires `X-Maverick-Token` to equal the token → else `401`. Body parsed as JSON, mapped via `mapClaudeHookEvent`; if mapped, calls `notifications.send({ workspaceId, type, title, body })` where `workspaceId` is the `X-Maverick-Workspace` header or `null`. Returns `200 {"continue":true}`. Any other path/method → `404`.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && bun test hook-server.test.ts`
Expected: FAIL — `HookServer` missing.

- [ ] **Step 3: Write the implementation**

```ts
// sidecar/hook-server.ts
import { randomBytes } from "crypto";
import { mapClaudeHookEvent } from "./hook-events";

interface NotificationSink {
  send(params: { workspaceId?: string | null; type: string; title: string; body: string }): unknown;
}

export interface HookServerOptions {
  notifications: NotificationSink;
  token?: string;
}

const OK = JSON.stringify({ continue: true });

/**
 * Loopback-only HTTP receiver for Claude Code lifecycle hooks. Bound to
 * 127.0.0.1 on an OS-assigned port and gated by a random per-process token so no
 * other local process can spoof notifications. Maps each event via
 * mapClaudeHookEvent and forwards to NotificationService.
 */
export class HookServer {
  private readonly notifications: NotificationSink;
  private readonly token: string;
  private server: ReturnType<typeof Bun.serve> | null = null;

  constructor(opts: HookServerOptions) {
    this.notifications = opts.notifications;
    this.token = opts.token ?? randomBytes(24).toString("hex");
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (req) => this.handle(req),
    });
  }

  endpoint(): { port: number; token: string } {
    if (!this.server) throw new Error("HookServer not started");
    return { port: this.server.port, token: this.token };
  }

  stop(): void {
    this.server?.stop(true);
    this.server = null;
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method !== "POST" || url.pathname !== "/agent-hook") {
      return new Response("not found", { status: 404 });
    }
    if (req.headers.get("X-Maverick-Token") !== this.token) {
      return new Response("unauthorized", { status: 401 });
    }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response("bad request", { status: 400 });
    }
    const mapped = mapClaudeHookEvent(body);
    if (mapped) {
      const workspaceId = req.headers.get("X-Maverick-Workspace") || null;
      this.notifications.send({ workspaceId, ...mapped });
    }
    return new Response(OK, { status: 200, headers: { "Content-Type": "application/json" } });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && bun test hook-server.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add sidecar/hook-server.ts sidecar/hook-server.test.ts
git commit -m "feat(sidecar): loopback hook HTTP server"
```

---

## Task 4: RPC `hooks.claudeSettingsPath` + HookServer ownership

**Files:**
- Modify: `sidecar/rpc-handlers.ts`
- Test: `sidecar/rpc-handlers.test.ts`

The handler lazily starts a `HookServer` (built from `this.notifications`), writes the per-workspace settings file, and returns its path.

- [ ] **Step 1: Write the failing test**

Add to `sidecar/rpc-handlers.test.ts`:

```ts
import { existsSync, readFileSync, rmSync } from "fs";

it("hooks.claudeSettingsPath writes a settings file wired to the running hook server", async () => {
  const handlers = new RpcHandlers({ store: new SQLiteStore(":memory:") });
  const { path } = (await handlers.dispatch("hooks.claudeSettingsPath", {
    workspaceId: "ws_hooktest",
  })) as { path: string };
  expect(existsSync(path)).toBe(true);
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  expect(parsed.env.MAVERICK_WS).toBe("ws_hooktest");
  expect(parsed.hooks.Notification[0].hooks[0].url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/agent-hook$/);
  rmSync(path, { force: true });
  handlers.stopHookServer();
});
```

> If `RpcHandlers` in this file is constructed differently (check the top of `rpc-handlers.test.ts` for the existing helper/factory), use that same construction instead of `new RpcHandlers({ store })`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && bun test rpc-handlers.test.ts -t "claudeSettingsPath"`
Expected: FAIL — no such method (dispatch returns undefined / throws), or `stopHookServer` missing.

- [ ] **Step 3: Add the schema, the lazy server, the dispatch case, and cleanup**

In `sidecar/rpc-handlers.ts`:

Add imports near the other sidecar-module imports (after line ~33):

```ts
import { HookServer } from "./hook-server";
import { writeClaudeHooksFile } from "./claude-hooks";
```

Add to the `Schemas` object (alongside the other entries):

```ts
  hooksClaudeSettingsPath: z.object({ workspaceId: z.string() }),
```

Add a private field + lazy getter to the class (near the other `readonly` service fields):

```ts
  private hookServer: HookServer | null = null;

  private async ensureHookServer(): Promise<HookServer> {
    if (!this.hookServer) {
      this.hookServer = new HookServer({ notifications: this.notifications });
      await this.hookServer.start();
    }
    return this.hookServer;
  }

  /** Test/shutdown hook: close the loopback receiver if it was started. */
  stopHookServer(): void {
    this.hookServer?.stop();
    this.hookServer = null;
  }
```

Add the dispatch case (next to the other cases in `dispatch`):

```ts
      case "hooks.claudeSettingsPath": {
        const p = Schemas.hooksClaudeSettingsPath.parse(params);
        const server = await this.ensureHookServer();
        const { port, token } = server.endpoint();
        const path = writeClaudeHooksFile({ workspaceId: p.workspaceId, port, token });
        return { path };
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && bun test rpc-handlers.test.ts -t "claudeSettingsPath"`
Expected: PASS.

- [ ] **Step 5: Full sidecar test run**

Run: `cd sidecar && bun test`
Expected: PASS (no regressions).

- [ ] **Step 6: Commit**

```bash
git add sidecar/rpc-handlers.ts sidecar/rpc-handlers.test.ts
git commit -m "feat(sidecar): hooks.claudeSettingsPath RPC + hook server ownership"
```

---

## Task 5: Rust command passthrough

**Files:**
- Create: `src-tauri/src/commands/hooks.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

Thin passthrough, mirroring `instructions_resolve`. No unit test (matches existing convention for passthrough commands).

- [ ] **Step 1: Create the command**

```rust
// src-tauri/src/commands/hooks.rs
use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn hooks_claude_settings_path(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request("hooks.claudeSettingsPath", json!({ "workspaceId": workspace_id }))
        .await
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register the module + re-export**

In `src-tauri/src/commands/mod.rs`, add the module declaration in alphabetical position (after `pub mod git;`):

```rust
pub mod hooks;
```

And add the re-export (after `pub use git::{...};`):

```rust
pub use hooks::hooks_claude_settings_path;
```

- [ ] **Step 3: Register in the invoke handler**

In `src-tauri/src/lib.rs`, add `hooks_claude_settings_path,` to the `tauri::generate_handler![ ... ]` list (near `instructions_resolve,`).

- [ ] **Step 4: Verify it compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles with no errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/hooks.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): hooks_claude_settings_path command"
```

---

## Task 6: Frontend tauri binding

**Files:**
- Modify: `src/lib/tauri.ts`
- Test: `src/lib/tauri.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/tauri.test.ts` (follow the existing MSW/invoke-mock pattern already used in that file — mock `hooks_claude_settings_path` to return `{ path: "/tmp/ws.json" }`):

```ts
it("hooksClaudeSettingsPath invokes hooks_claude_settings_path and returns the path", async () => {
  mockInvoke("hooks_claude_settings_path", { path: "/tmp/ws_1.json" });
  const { hooksClaudeSettingsPath } = await import("./tauri");
  await expect(hooksClaudeSettingsPath("ws_1")).resolves.toEqual({ path: "/tmp/ws_1.json" });
  expect(lastInvokeArgs("hooks_claude_settings_path")).toEqual({ workspaceId: "ws_1" });
});
```

> Match the exact mock helpers used elsewhere in `tauri.test.ts` (e.g. how `projectAdd`/`instructionsResolve` are tested). Adapt names accordingly.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run src/lib/tauri.test.ts -t "hooksClaudeSettingsPath"`
Expected: FAIL — export missing.

- [ ] **Step 3: Add the binding**

In `src/lib/tauri.ts`, near the other notify bindings:

```ts
export async function hooksClaudeSettingsPath(workspaceId: string): Promise<{ path: string }> {
  return invoke("hooks_claude_settings_path", { workspaceId });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run src/lib/tauri.test.ts -t "hooksClaudeSettingsPath"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tauri.ts src/lib/tauri.test.ts
git commit -m "feat(ui): hooksClaudeSettingsPath tauri binding"
```

---

## Task 7: Inject `--settings <path>` for Claude launches

**Files:**
- Modify: `src/hooks/useLaunchSpec.ts`
- Test: `src/hooks/useLaunchSpec.test.ts` (create if absent)

Add a command-detection helper and fetch the settings path before typing the launch command, prepending `--settings <path>` to the args. Fail open (launch without it) if the RPC throws.

- [ ] **Step 1: Write the failing test**

Create/extend `src/hooks/useLaunchSpec.test.ts`. Follow the mocking style already used by sibling hook tests (`vi.mock("@/lib/tauri", ...)`). Core assertions:

```ts
import { describe, it, expect } from "vitest";
import { isClaudeLaunchCommand } from "./useLaunchSpec";

describe("isClaudeLaunchCommand", () => {
  it("matches bare and pathed claude binaries", () => {
    expect(isClaudeLaunchCommand("claude")).toBe(true);
    expect(isClaudeLaunchCommand("/Users/x/.local/bin/claude")).toBe(true);
    expect(isClaudeLaunchCommand("claude.cmd")).toBe(true);
    expect(isClaudeLaunchCommand("C:\\bin\\claude.exe")).toBe(true);
  });
  it("does not match other CLIs", () => {
    expect(isClaudeLaunchCommand("codex")).toBe(false);
    expect(isClaudeLaunchCommand("gemini")).toBe(false);
    expect(isClaudeLaunchCommand("claude-code-helper")).toBe(false);
  });
});
```

> A full render test of the effect (asserting `ptyWrite` receives `--settings`) is ideal but heavier; if the existing test harness for `useLaunchSpec` supports it, add: mock `hooksClaudeSettingsPath` → `{ path: "/tmp/ws.json" }`, stage a claude LaunchSpec, assert the first `ptyWrite` call contains `--settings /tmp/ws.json`. Otherwise the exported `isClaudeLaunchCommand` unit test above is the required coverage and the effect wiring is verified in the Task 11 smoke test.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run src/hooks/useLaunchSpec.test.ts`
Expected: FAIL — `isClaudeLaunchCommand` not exported.

- [ ] **Step 3: Implement**

In `src/hooks/useLaunchSpec.ts`:

Add the import:

```ts
import { ptyWrite, onPtyData, onPtyExit, hooksClaudeSettingsPath } from "@/lib/tauri";
```

Add the exported helper (module scope):

```ts
/** True when a launch command invokes the Claude Code CLI (bare, pathed, .cmd/.exe). */
export function isClaudeLaunchCommand(command: string): boolean {
  const base = command.split(/[\\/]/).pop() ?? command;
  return /^claude(\.cmd|\.exe)?$/i.test(base);
}
```

Replace the synchronous launch-command write. Currently:

```ts
    useAgentStatusStore.getState().setStatus(workspaceId, "working");
    void ptyWrite(ptyId, buildLaunchCommandLine(spec, launchShell())).catch(() => {});
```

with an async resolve of the Claude hooks settings, prepending `--settings <path>`:

```ts
    useAgentStatusStore.getState().setStatus(workspaceId, "working");
    void (async () => {
      let args = spec.args;
      if (isClaudeLaunchCommand(spec.command)) {
        try {
          const { path } = await hooksClaudeSettingsPath(workspaceId);
          args = ["--settings", path, ...spec.args];
        } catch {
          // Fail open: launch Claude without hook notifications rather than block.
        }
      }
      await ptyWrite(ptyId, buildLaunchCommandLine({ ...spec, args }, launchShell()));
    })().catch(() => {});
```

Leave the rest of the effect (watcher, `onPtyData`→`reportOutput`, `onPtyExit`→`markExit`, cleanup) unchanged — they still attach synchronously after this block, so the prompt-paste idle watcher and status pill keep working.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run src/hooks/useLaunchSpec.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLaunchSpec.ts src/hooks/useLaunchSpec.test.ts
git commit -m "feat(ui): launch Claude with --settings hook config"
```

---

## Task 8: Remove BEL→attention from the byte-stream heuristic

**Files:**
- Modify: `src/hooks/useAgentStatus.ts`
- Test: `src/hooks/useAgentStatus.test.ts`

Output always maps to `working`; delete `ATTENTION_PATTERN` and `streamRequestsAttention`. `markExit` keeps setting `done`/`error` for the pill.

- [ ] **Step 1: Update the tests first**

In `src/hooks/useAgentStatus.test.ts`:
- Delete any tests importing/asserting `streamRequestsAttention` and any test asserting BEL/`\x07` output produces `"attention"`.
- Add a regression test:

```ts
it("does not enter 'attention' on a BEL byte (hooks own attention now)", () => {
  const { result } = renderHook(() => useAgentStatusReporter("ws_bel"));
  act(() => result.current.reportOutput("ding\x07"));
  expect(useAgentStatusStore.getState().statuses["ws_bel"]).toBe("working");
});
```

> Keep existing working→idle timer tests and `markExit` done/error tests as-is.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run src/hooks/useAgentStatus.test.ts`
Expected: FAIL — the new test fails (still returns "attention"), and/or removed-symbol tests error.

- [ ] **Step 3: Implement**

In `src/hooks/useAgentStatus.ts`:
- Delete these two declarations:

```ts
/** BEL or the iTerm2/macOS attention OSC (ESC ] 9 ; …) signals user attention. */
const ATTENTION_PATTERN = /\x07|\x1b\]9;/;

export function streamRequestsAttention(data: string): boolean {
  return ATTENTION_PATTERN.test(data);
}
```

- In `reportOutputRef.current`, change:

```ts
    setStatus(workspaceId, streamRequestsAttention(data) ? "attention" : "working");
```

to:

```ts
    setStatus(workspaceId, "working");
```

- Update the block comment above `useAgentStatusReporter` to drop the BEL/attention sentence (attention is now hook-driven; the byte stream only distinguishes working/idle, and markExit sets done/error).

> Note: the `data` parameter of `reportOutputRef.current` stays (it still gates on `exitedRef` and arms the idle timer); it is simply no longer pattern-matched.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run src/hooks/useAgentStatus.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAgentStatus.ts src/hooks/useAgentStatus.test.ts
git commit -m "fix(status): stop deriving 'attention' from BEL bytes"
```

---

## Task 9: Delete the byte-stream→notify bridge

**Files:**
- Delete: `src/hooks/useAgentNotifications.ts`, `src/hooks/useAgentNotifications.test.ts`
- Modify: `src/components/workbench/Workbench.tsx`

- [ ] **Step 1: Remove the mount**

In `src/components/workbench/Workbench.tsx`:
- Delete the import line: `import { useAgentNotifications } from "@/hooks/useAgentNotifications";`
- Delete the call line: `useAgentNotifications();`

- [ ] **Step 2: Delete the hook + its test**

```bash
git rm src/hooks/useAgentNotifications.ts src/hooks/useAgentNotifications.test.ts
```

- [ ] **Step 3: Verify nothing else references it**

Run: `grep -rn "useAgentNotifications" src`
Expected: no matches.

- [ ] **Step 4: Run the affected suites**

Run: `bun run vitest run src/components/workbench src/hooks`
Expected: PASS (Workbench renders without the hook; no dangling import).

- [ ] **Step 5: Commit**

```bash
git add src/components/workbench/Workbench.tsx
git commit -m "refactor(notifications): remove byte-stream notify bridge (hooks own it)"
```

---

## Task 10: Full build, typecheck, and test sweep

**Files:** none (verification).

- [ ] **Step 1: TypeScript build**

Run: `bun run build`
Expected: succeeds, no type errors. (Fix any type fallout, e.g. stray imports of the deleted `streamRequestsAttention`/`useAgentNotifications` — `grep -rn "streamRequestsAttention" src` should be empty.)

- [ ] **Step 2: Rust check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles.

- [ ] **Step 3: Sidecar tests**

Run: `cd sidecar && bun test`
Expected: PASS.

- [ ] **Step 4: Frontend tests**

Run: `bun run vitest run`
Expected: PASS. (Coverage gate is pre-existingly red on main per project notes — ensure the NEW/CHANGED files above are fully covered; do not regress unrelated coverage.)

- [ ] **Step 5: Commit any fixups**

```bash
git add -A
git commit -m "test: green build/typecheck/tests for hook-driven notifications"
```

---

## Task 11: Live smoke test — verify the `http` hook (with curl fallback decision)

**Files:** possibly `sidecar/claude-hooks.ts` (only if `http` hooks are unsupported).

This is the one runtime assumption to confirm: that the installed `claude` accepts `type: "http"` hooks.

- [ ] **Step 1: Launch the app**

Run: `bun run tauri dev`

- [ ] **Step 2: Exercise the flow**

Create/open a Claude workspace. Give Claude a task that triggers a permission prompt (e.g. ask it to run a shell command under default permissions), then let it finish a turn. Watch for OS notifications: exactly one "Agent needs input" on the permission prompt and one "Agent finished" on completion — no bursts from spinners/progress output.

- [ ] **Step 3: Confirm no false positives**

Run a task with lots of streaming output (spinners, progress bars). Expected: NO notifications during streaming (the BEL spam is gone).

- [ ] **Step 4: If `http` hooks are NOT honored by this `claude` build**

Symptom: no notifications at all, and `claude` logs a hook-schema error (check with `claude --debug` or the session's hook logs). Fallback — switch the hook `type` from `http` to `command` in `sidecar/claude-hooks.ts`'s `httpHook`:

```ts
function commandHook(port: number, token: string) {
  const url = `http://127.0.0.1:${port}/agent-hook`;
  // curl reads the event JSON from stdin and forwards it; -s keeps hooks quiet.
  const cmd =
    `curl -s -m 5 -X POST ${url} ` +
    `-H "X-Maverick-Token: ${token}" ` +
    `-H "X-Maverick-Workspace: \${MAVERICK_WS}" ` +
    `-H "Content-Type: application/json" --data-binary @- >/dev/null 2>&1 || true`;
  return { hooks: [{ type: "command", command: cmd, timeout: 5 }] };
}
```

Update `buildClaudeHooksSettings` to use `commandHook`, update `claude-hooks.test.ts` expectations (assert `type: "command"` and that the command string contains the url/token/`${MAVERICK_WS}`), rerun `cd sidecar && bun test claude-hooks.test.ts`, and re-verify Steps 2–3. curl is present on the target macOS and the sidecar augments PATH.

- [ ] **Step 5: Commit (only if the fallback was needed)**

```bash
git add sidecar/claude-hooks.ts sidecar/claude-hooks.test.ts
git commit -m "fix(sidecar): use command+curl hook (http unsupported by installed claude)"
```

- [ ] **Step 6: Update memory**

Record the verified transport (http vs command) and the branch outcome per the project's memory conventions.

---

## Self-Review Notes (author)

- **Spec coverage:** HookServer (Task 3), settings injection via `--settings` (Tasks 2,4,5,6,7), event mapping incl. StopFailure→error (Task 1), workspace correlation via header/env (Tasks 2,3), frontend decoupling — pill kept, bridge deleted (Tasks 8,9), fail-open on missing header (Task 3) and on RPC failure (Task 7), loopback+token security (Task 3). All spec sections map to a task.
- **Type consistency:** `mapClaudeHookEvent` returns `{type,title,body}`; `HookServer.send` spreads it with `workspaceId`; `NotificationService.send` accepts `{workspaceId?,type?,title,body}` (existing signature — `workspaceId:null` is normalized to `?? null` in `notificationInsert`). `hooks.claudeSettingsPath` returns `{path}` consistently across sidecar RPC → Rust → tauri binding → `useLaunchSpec`. `isClaudeLaunchCommand` name is stable across Task 7.
- **Placeholders:** none — every code step is complete.
- **Known caveat:** `http` hook support is the sole unverified runtime assumption; Task 11 verifies it and carries the concrete `command`+curl fallback.
