import { describe, test, expect } from "bun:test";
import { AgentRunner, supportsHeadless, HeadlessUnsupportedError } from "./agent-runner";
import type { ManagedProc, Spawner } from "./process-manager";
import type { Notifier } from "./types";

const ids = { uuid: (p: string) => `${p}_1`, now: () => 0 };

function settle(): Promise<void> {
  return new Promise((r) => setTimeout(r, 10));
}

function capture(): { notifier: Notifier; events: Array<{ method: string; params: any }> } {
  const events: Array<{ method: string; params: any }> = [];
  return {
    events,
    notifier: {
      write(line: string) {
        const m = JSON.parse(line) as { method: string; params: unknown };
        events.push({ method: m.method, params: m.params });
      },
    },
  };
}

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

function fakeProc(opts: { out?: string[]; err?: string[]; code?: number; outStream?: ReadableStream<Uint8Array> }) {
  const writes: string[] = [];
  const state = { ended: false, killed: false };
  const proc: ManagedProc = {
    kill: () => { state.killed = true; },
    stdin: {
      write: (d: string | Uint8Array) => { writes.push(String(d)); },
      end: () => { state.ended = true; },
    } as ManagedProc["stdin"],
    stdout: opts.outStream ?? streamOf(opts.out ?? []),
    stderr: streamOf(opts.err ?? []),
    exitCode: opts.code ?? 0,
    exited: Promise.resolve(opts.code ?? 0),
  };
  return { proc, writes, state };
}

function harness(procOpts: Parameters<typeof fakeProc>[0]) {
  const calls: string[][] = [];
  const fp = fakeProc(procOpts);
  const spawn: Spawner = (cmd) => {
    calls.push(cmd);
    return fp.proc;
  };
  const cap = capture();
  const runner = new AgentRunner({ spawn, notifier: cap.notifier, ids });
  return { runner, calls, events: cap.events, ...fp };
}

describe("supportsHeadless", () => {
  test("claude-code is supported; unknown backends are not", () => {
    expect(supportsHeadless("claude-code")).toBe(true);
    expect(supportsHeadless("gemini")).toBe(false);
  });
});

describe("AgentRunner.run", () => {
  test("spawns the claude headless argv, writes+closes stdin, returns an agentId", async () => {
    const h = harness({ out: [] });
    const { agentId } = h.runner.run({ workspaceId: "w1", backend: "claude-code", prompt: "do it", cwd: "/wt" });
    expect(agentId).toBe("agent_1");
    expect(h.calls[0]).toEqual([
      "claude", "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits",
    ]);
    await settle();
    // stdin: prompt written, then closed (EOF) on the next microtask so print mode runs.
    expect(h.writes).toEqual(["do it"]);
    expect(h.state.ended).toBe(true);
  });

  test("--resume <sessionId> is appended for follow-up turns", () => {
    const h = harness({ out: [] });
    h.runner.run({ workspaceId: "w1", backend: "claude-code", prompt: "p", resumeSessionId: "sess-9" });
    expect(h.calls[0]).toContain("--resume");
    expect(h.calls[0][h.calls[0].indexOf("--resume") + 1]).toBe("sess-9");
  });

  test("permissionMode override flows into argv", () => {
    const h = harness({ out: [] });
    h.runner.run({ workspaceId: "w1", backend: "claude-code", prompt: "p", permissionMode: "dangerously-skip-permissions" });
    expect(h.calls[0][h.calls[0].indexOf("--permission-mode") + 1]).toBe("dangerously-skip-permissions");
  });

  test("streams stdout + stderr as agent.data with a stream tag, then agent.exit", async () => {
    const h = harness({ out: ['{"type":"result"}\n'], err: ["boom warning\n"], code: 0 });
    h.runner.run({ workspaceId: "w1", backend: "claude-code", prompt: "p" });
    await settle();
    const data = h.events.filter((e) => e.method === "agent.data");
    expect(data.some((e) => e.params.stream === "stdout" && e.params.data.includes("result"))).toBe(true);
    expect(data.some((e) => e.params.stream === "stderr" && e.params.data.includes("boom"))).toBe(true);
    const exit = h.events.find((e) => e.method === "agent.exit");
    expect(exit?.params).toMatchObject({ agentId: "agent_1", workspaceId: "w1", code: 0 });
    expect(h.runner.has("agent_1")).toBe(false);
  });

  test("emits agent.error when a stream read throws", async () => {
    const errStream = new ReadableStream<Uint8Array>({ pull() { throw new Error("read failed"); } });
    const h = harness({ outStream: errStream });
    h.runner.run({ workspaceId: "w1", backend: "claude-code", prompt: "p" });
    await settle();
    expect(h.events.some((e) => e.method === "agent.error" && e.params.message.includes("read failed"))).toBe(true);
  });

  test("throws HeadlessUnsupportedError for an unsupported backend", () => {
    const h = harness({ out: [] });
    expect(() => h.runner.run({ workspaceId: "w1", backend: "gemini", prompt: "p" })).toThrow(
      HeadlessUnsupportedError
    );
  });
});

describe("AgentRunner.kill", () => {
  test("kill() stops the proc and forgets the run; missing id is a no-op", () => {
    const h = harness({ out: [] });
    h.runner.run({ workspaceId: "w1", backend: "claude-code", prompt: "p" });
    expect(h.runner.has("agent_1")).toBe(true);
    expect(h.runner.kill({ agentId: "agent_1" })).toEqual({ ok: true });
    expect(h.state.killed).toBe(true);
    expect(h.runner.has("agent_1")).toBe(false);
    expect(h.runner.kill({ agentId: "nope" })).toEqual({ ok: true });
  });

  test("killWorkspace kills only that workspace's runs", () => {
    const h = harness({ out: [] });
    h.runner.run({ workspaceId: "w1", backend: "claude-code", prompt: "p" });
    expect(h.runner.size()).toBe(1);
    h.runner.killWorkspace("other");
    expect(h.runner.size()).toBe(1);
    h.runner.killWorkspace("w1");
    expect(h.runner.size()).toBe(0);
  });
});
