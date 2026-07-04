import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AgentSessionManager } from "./session-manager";
import { SQLiteStore, defaultMigrationsDir } from "../sqlite-store";
import type { ManagedProc, Spawner } from "../process-manager";
import type { Notifier } from "../types";

class FakeProc implements ManagedProc {
  written: string[] = [];
  exitCode: number | null = null;
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  stdout = new ReadableStream<Uint8Array>({ start: (c) => (this.controller = c) });
  stderr = new ReadableStream<Uint8Array>({ start: () => {} });
  stdin = {
    write: (d: string | Uint8Array) => {
      if (stdinError) throw stdinError;
      return this.written.push(typeof d === "string" ? d : new TextDecoder().decode(d));
    },
  };
  private resolveExit!: (code: number) => void;
  exited = new Promise<number>((r) => (this.resolveExit = r));
  kill() { this.exit(143); }
  pushLine(obj: unknown) { this.controller.enqueue(new TextEncoder().encode(JSON.stringify(obj) + "\n")); }
  exit(code: number) { this.exitCode = code; this.controller.close(); this.resolveExit(code); }
}

let store: SQLiteStore;
let procs: FakeProc[];
let spawnedCmds: string[][];
let events: Array<{ method: string; params: { sessionId: string; event: { type: string } & Record<string, unknown> } }>;
let mgr: AgentSessionManager;
let ws: ReturnType<SQLiteStore["workspaceCreate"]>;
let attachmentsRoot: string;
// Failure knobs: when set, FakeProc.stdin.write / fakeCheckpoints.restore throw.
let stdinError: Error | null;
let restoreError: Error | null;

const spawn: Spawner = (cmd) => {
  const p = new FakeProc();
  procs.push(p);
  spawnedCmds.push(cmd);
  return p;
};
const notifier: Notifier = { write: (line) => events.push(JSON.parse(line)) };

function eventTypes(): string[] {
  return events.map((e) => e.params.event.type);
}
async function tick() { await new Promise((r) => setTimeout(r, 10)); }

beforeEach(() => {
  // Same in-memory + migrations-dir construction the sqlite-store tests use.
  store = new SQLiteStore({ path: ":memory:", migrationsDir: defaultMigrationsDir() });
  procs = [];
  spawnedCmds = [];
  events = [];
  // Nest an "attachments" segment under the temp dir so the real path-shape
  // assertion (`/attachments/<sessionId>/`) still holds without touching ~/.maverick.
  attachmentsRoot = join(mkdtempSync(join(tmpdir(), "mv-agent-")), "attachments");
  stdinError = null;
  restoreError = null;
  const fakeCheckpoints = {
    snapshot: async () => "cafebabe".repeat(5),
    restore: async () => { if (restoreError) throw restoreError; },
    dropRef: async () => {},
  };
  mgr = new AgentSessionManager({ store, notifier, spawn, checkpoints: fakeCheckpoints as never, attachmentsRoot });
  const project = store.projectAdd({ path: "/tmp/proj" });
  ws = store.workspaceCreate({ projectId: project.id, branch: "b", agentBackend: "claude", worktreePath: "/tmp/proj-wt", mode: "agent" });
});

describe("send", () => {
  test("first send spawns the CLI, persists + emits the user message, writes stdin, goes working", async () => {
    const res = await mgr.send(ws.sessionId, [{ type: "text", text: "hi" }]);
    expect(res.queued).toBe(false);
    expect(spawnedCmds).toHaveLength(1);
    expect(spawnedCmds[0][0]).toBe("claude");
    expect(procs[0].written).toHaveLength(1);
    expect(JSON.parse(procs[0].written[0]).type).toBe("user");
    const persisted = store.messagesList({ sessionId: ws.sessionId });
    expect(persisted).toHaveLength(1);
    expect(persisted[0].role).toBe("user");
    expect(eventTypes()).toEqual(expect.arrayContaining(["message-start", "message-end", "status"]));
    expect(mgr.state(ws.id).status).toBe("working");
  });

  test("a checkpoint row is recorded for the user message", async () => {
    await mgr.send(ws.sessionId, [{ type: "text", text: "hi" }]);
    const [m] = store.messagesList({ sessionId: ws.sessionId });
    const cp = store.checkpointByMessage(ws.sessionId, m.id);
    expect(cp?.gitSha).toBe("cafebabe".repeat(5));
  });

  test("assistant turn streams through and persists on message-end; turn-end returns to idle", async () => {
    await mgr.send(ws.sessionId, [{ type: "text", text: "hi" }]);
    procs[0].pushLine({ type: "system", subtype: "init", session_id: "prov1", model: "m" });
    procs[0].pushLine({ type: "assistant", message: { id: "m1", role: "assistant", content: [{ type: "text", text: "yo" }] }, session_id: "prov1" });
    procs[0].pushLine({ type: "result", subtype: "success", is_error: false, duration_ms: 5, usage: { input_tokens: 1, output_tokens: 2 }, session_id: "prov1" });
    await tick();
    expect(store.sessionMetaGet(ws.sessionId)?.providerSessionId).toBe("prov1");
    const msgs = store.messagesList({ sessionId: ws.sessionId });
    expect(msgs).toHaveLength(2);
    expect(JSON.parse(msgs[1].partsJson!)).toEqual([{ type: "text", text: "yo" }]);
    expect(mgr.state(ws.id).status).toBe("idle");
    expect(eventTypes()).toContain("turn-end");
  });

  test("send during an active turn queues; queue drains after turn-end", async () => {
    await mgr.send(ws.sessionId, [{ type: "text", text: "one" }]);
    const res2 = await mgr.send(ws.sessionId, [{ type: "text", text: "two" }]);
    expect(res2.queued).toBe(true);
    expect(mgr.state(ws.id).queue).toHaveLength(1);
    expect(eventTypes()).toContain("queue-updated");
    procs[0].pushLine({ type: "result", subtype: "success", is_error: false, duration_ms: 1, usage: { input_tokens: 1, output_tokens: 1 }, session_id: "p" });
    await tick();
    expect(procs[0].written).toHaveLength(2); // second turn auto-sent on same proc
    expect(mgr.state(ws.id).queue).toHaveLength(0);
    expect(mgr.state(ws.id).status).toBe("working");
  });

  test("queueRemove drops a queued message", async () => {
    await mgr.send(ws.sessionId, [{ type: "text", text: "one" }]);
    await mgr.send(ws.sessionId, [{ type: "text", text: "two" }]);
    const q = mgr.state(ws.id).queue[0];
    mgr.queueRemove(ws.sessionId, q.id);
    expect(mgr.state(ws.id).queue).toHaveLength(0);
  });
});

describe("options + respawn", () => {
  test("setOptions persists and forces a respawn with --resume on the next turn", async () => {
    await mgr.send(ws.sessionId, [{ type: "text", text: "one" }]);
    procs[0].pushLine({ type: "system", subtype: "init", session_id: "prov1", model: "m" });
    procs[0].pushLine({ type: "result", subtype: "success", is_error: false, duration_ms: 1, usage: { input_tokens: 1, output_tokens: 1 }, session_id: "prov1" });
    await tick();
    mgr.setOptions(ws.sessionId, { model: "claude-opus-4-8" });
    expect(store.sessionMetaGet(ws.sessionId)?.model).toBe("claude-opus-4-8");
    await mgr.send(ws.sessionId, [{ type: "text", text: "two" }]);
    expect(spawnedCmds).toHaveLength(2);
    expect(spawnedCmds[1]).toEqual(expect.arrayContaining(["--model", "claude-opus-4-8", "--resume", "prov1"]));
  });
});

describe("interrupt + exit + errors", () => {
  test("interrupt writes the control line", async () => {
    await mgr.send(ws.sessionId, [{ type: "text", text: "one" }]);
    await mgr.interrupt(ws.sessionId);
    expect(procs[0].written.some((l) => JSON.parse(l).type === "control_request")).toBe(true);
  });

  test("nonzero exit mid-turn emits error and flips status", async () => {
    await mgr.send(ws.sessionId, [{ type: "text", text: "one" }]);
    procs[0].exit(1);
    await tick();
    expect(mgr.state(ws.id).status).toBe("error");
    expect(eventTypes()).toContain("error");
  });

  test("send after a dead proc respawns transparently", async () => {
    await mgr.send(ws.sessionId, [{ type: "text", text: "one" }]);
    procs[0].exit(1);
    await tick();
    await mgr.send(ws.sessionId, [{ type: "text", text: "retry" }]);
    expect(spawnedCmds).toHaveLength(2);
    expect(mgr.state(ws.id).status).toBe("working");
  });

  test("an error turn does not auto-drain the queue", async () => {
    await mgr.send(ws.sessionId, [{ type: "text", text: "one" }]);
    await mgr.send(ws.sessionId, [{ type: "text", text: "two" }]);
    procs[0].pushLine({ type: "result", subtype: "error", is_error: true, result: "boom", duration_ms: 1, usage: { input_tokens: 1, output_tokens: 1 }, session_id: "p" });
    await tick();
    expect(mgr.state(ws.id).status).toBe("error");
    expect(mgr.state(ws.id).queue).toHaveLength(1);
    expect(procs[0].written).toHaveLength(1); // queued message was NOT auto-sent
  });

  test("interrupt stdin failure rejects, flips status to error, and forces respawn on next send", async () => {
    await mgr.send(ws.sessionId, [{ type: "text", text: "one" }]);
    expect(mgr.state(ws.id).status).toBe("working");
    stdinError = new Error("EPIPE");
    await expect(mgr.interrupt(ws.sessionId)).rejects.toThrow("EPIPE");
    expect(mgr.state(ws.id).status).toBe("error");
    expect(eventTypes()).toContain("error");
    stdinError = null;
    await mgr.send(ws.sessionId, [{ type: "text", text: "two" }]);
    expect(spawnedCmds).toHaveLength(2); // needsRespawn forced a fresh proc
    expect(procs[1].written).toHaveLength(1);
    expect(mgr.state(ws.id).status).toBe("working");
  });

  test("stdin write failure flags error but send resolves; next send respawns and works", async () => {
    stdinError = new Error("EPIPE");
    const res = await mgr.send(ws.sessionId, [{ type: "text", text: "one" }]);
    expect(res.queued).toBe(false);
    expect(res.turnId).toBeDefined();
    expect(mgr.state(ws.id).status).toBe("error");
    expect(eventTypes()).toContain("error");
    expect(store.messagesList({ sessionId: ws.sessionId })).toHaveLength(1); // user message persisted
    stdinError = null;
    await mgr.send(ws.sessionId, [{ type: "text", text: "two" }]);
    expect(spawnedCmds).toHaveLength(2);
    expect(procs[1].written).toHaveLength(1);
    expect(mgr.state(ws.id).status).toBe("working");
  });
});

describe("rewind", () => {
  test("rewind restores checkpoint, truncates messages, clears provider session when fork impossible", async () => {
    await mgr.send(ws.sessionId, [{ type: "text", text: "one" }]);
    procs[0].pushLine({ type: "assistant", message: { id: "m1", role: "assistant", content: [{ type: "text", text: "reply" }] }, session_id: "p1" });
    procs[0].pushLine({ type: "result", subtype: "success", is_error: false, duration_ms: 1, usage: { input_tokens: 1, output_tokens: 1 }, session_id: "p1" });
    await tick();
    const [userMsg] = store.messagesList({ sessionId: ws.sessionId });
    await mgr.rewind(ws.sessionId, userMsg.id);
    expect(store.messagesList({ sessionId: ws.sessionId })).toHaveLength(0);
    // Fake worktree has no ~/.claude session file → fork fails → fresh provider session.
    expect(store.sessionMetaGet(ws.sessionId)?.providerSessionId).toBeNull();
    expect(mgr.state(ws.id).status).toBe("idle");
  });

  test("rewind restore failure mid-turn rethrows, flips working→idle, keeps history, session stays usable", async () => {
    // No result line is pushed: the turn is still in flight, so status is
    // "working" going into rewind — the idle assertion below discriminates the
    // fix instead of passing vacuously on an already-idle session.
    await mgr.send(ws.sessionId, [{ type: "text", text: "one" }]);
    expect(mgr.state(ws.id).status).toBe("working");
    const [userMsg] = store.messagesList({ sessionId: ws.sessionId });
    restoreError = new Error("restore boom");
    await expect(mgr.rewind(ws.sessionId, userMsg.id)).rejects.toThrow("restore boom");
    expect(mgr.state(ws.id).status).toBe("idle");
    expect(store.messagesList({ sessionId: ws.sessionId })).toHaveLength(1); // NOT truncated
    expect(eventTypes()).toContain("error");
    restoreError = null;
    await mgr.send(ws.sessionId, [{ type: "text", text: "again" }]);
    expect(spawnedCmds).toHaveLength(2); // respawned after the killed proc
    expect(mgr.state(ws.id).status).toBe("working");
  });
});

describe("state + attachments", () => {
  test("state returns a snapshot for an untouched agent workspace", () => {
    const snap = mgr.state(ws.id);
    expect(snap).toMatchObject({ sessionId: ws.sessionId, workspaceId: ws.id, status: "idle", queue: [] });
  });

  test("attachmentSave writes under <attachmentsRoot>/<sessionId>/ and sanitizes names", () => {
    const { path } = mgr.attachmentSave(ws.sessionId, "../evil name.txt", Buffer.from("hello").toString("base64"));
    expect(path).toContain(`/attachments/${ws.sessionId}/`);
    expect(path.endsWith("evil-name.txt")).toBe(true);
    expect(require("fs").readFileSync(path, "utf8")).toBe("hello");
  });
});
