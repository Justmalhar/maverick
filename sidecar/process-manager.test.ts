import { describe, test, expect } from "bun:test";
import { ProcessManager, defaultSpawner } from "./process-manager";
import type { ManagedProc, Spawner } from "./process-manager";

interface FakeProc extends ManagedProc {
  writes: string[];
  killed: boolean;
  signal?: string | number;
}

function fakeProc(stdoutChunks: string[] = [], exitCode = 0, throwOnRead = false): FakeProc {
  const writes: string[] = [];
  const encoder = new TextEncoder();
  let i = 0;
  let resolveExited: (n: number) => void;
  const exited = new Promise<number>((r) => (resolveExited = r));
  const stdout = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (throwOnRead) {
        controller.error(new Error("boom"));
        return;
      }
      if (i < stdoutChunks.length) {
        controller.enqueue(encoder.encode(stdoutChunks[i++]));
      } else {
        controller.close();
        queueMicrotask(() => resolveExited(exitCode));
      }
    },
  });
  const p: FakeProc = {
    writes,
    killed: false,
    exitCode: null,
    exited,
    stdout,
    stdin: {
      write(data: string | Uint8Array) {
        writes.push(typeof data === "string" ? data : new TextDecoder().decode(data));
        return Promise.resolve();
      },
    },
    kill(signal?: string | number) {
      p.killed = true;
      p.signal = signal;
    },
  };
  return p;
}

function makeManager(proc: ManagedProc, lines: string[] = []) {
  const ids = { uuid: (p: string) => `${p}_fixed`, now: () => 1 };
  const spawner: Spawner = () => proc;
  const notifier = { write: (l: string) => lines.push(l) };
  return new ProcessManager({ spawn: spawner, notifier, ids });
}

describe("ProcessManager", () => {
  test("spawn registers pty and returns id", async () => {
    const proc = fakeProc(["hello"]);
    const lines: string[] = [];
    const mgr = makeManager(proc, lines);
    const { ptyId } = mgr.spawn({ workspaceId: "ws", command: "echo", args: ["hi"] });
    expect(ptyId).toBe("pty_fixed");
    expect(mgr.has(ptyId)).toBe(true);
    await proc.exited;
    await Bun.sleep(10);
    expect(lines.some((l) => l.includes("pty.data"))).toBe(true);
    expect(lines.some((l) => l.includes("pty.exit"))).toBe(true);
    expect(mgr.size()).toBe(0);
  });

  test("write forwards data to stdin", async () => {
    const proc = fakeProc([]);
    const mgr = makeManager(proc);
    const { ptyId } = mgr.spawn({ workspaceId: "ws", command: "cat", args: [] });
    await mgr.write({ ptyId, data: "ping" });
    expect(proc.writes).toContain("ping");
  });

  test("write throws when pty not found", async () => {
    const mgr = makeManager(fakeProc([]));
    await expect(mgr.write({ ptyId: "missing", data: "x" })).rejects.toThrow(/PTY not found/);
  });

  test("write throws when stdin missing", async () => {
    const proc = fakeProc([]);
    proc.stdin = undefined;
    const mgr = makeManager(proc);
    const { ptyId } = mgr.spawn({ workspaceId: "ws", command: "nostdin", args: [] });
    await expect(mgr.write({ ptyId, data: "x" })).rejects.toThrow(/stdin not writable/);
  });

  test("resize updates dimensions", () => {
    const proc = fakeProc([]);
    const mgr = makeManager(proc);
    const { ptyId } = mgr.spawn({ workspaceId: "ws", command: "x", args: [] });
    expect(mgr.resize({ ptyId, cols: 120, rows: 40 })).toEqual({ ok: true });
  });

  test("resize throws when pty not found", () => {
    const mgr = makeManager(fakeProc([]));
    expect(() => mgr.resize({ ptyId: "x", cols: 80, rows: 24 })).toThrow();
  });

  test("kill terminates and removes pty", () => {
    const proc = fakeProc([]);
    const mgr = makeManager(proc);
    const { ptyId } = mgr.spawn({ workspaceId: "ws", command: "x", args: [] });
    expect(mgr.kill({ ptyId })).toEqual({ ok: true });
    expect(proc.killed).toBe(true);
    expect(mgr.has(ptyId)).toBe(false);
  });

  test("kill is no-op on unknown pty", () => {
    const mgr = makeManager(fakeProc([]));
    expect(mgr.kill({ ptyId: "ghost" })).toEqual({ ok: true });
  });

  test("pumpStdout emits pty.error on read failure", async () => {
    const proc = fakeProc([], 0, true);
    const lines: string[] = [];
    const mgr = makeManager(proc, lines);
    mgr.spawn({ workspaceId: "ws", command: "x", args: [] });
    await Bun.sleep(20);
    expect(lines.some((l) => l.includes("pty.error"))).toBe(true);
  });

  test("spawn handles missing stdout stream", async () => {
    const proc = fakeProc([]);
    proc.stdout = undefined;
    const lines: string[] = [];
    const mgr = makeManager(proc, lines);
    mgr.spawn({ workspaceId: "ws", command: "x", args: [] });
    await Bun.sleep(10);
    expect(lines.some((l) => l.includes("pty.exit"))).toBe(true);
  });

  test("defaultSpawner spawns a real subprocess", async () => {
    const proc = defaultSpawner(["echo", "hi"], {});
    const out = await new Response(proc.stdout!).text();
    expect(out.trim()).toBe("hi");
    proc.kill();
  });

  test("defaultSpawner respects env option", async () => {
    const proc = defaultSpawner(["sh", "-c", "echo $FOO"], { env: { FOO: "bar" } });
    const out = await new Response(proc.stdout!).text();
    expect(out.trim()).toBe("bar");
  });

  test("spawnOnce resolves with the child exit code", async () => {
    const proc: ManagedProc = { exitCode: 5, exited: Promise.resolve(5), kill() {} };
    const mgr = makeManager(proc);
    const { code } = await mgr.spawnOnce({ cwd: "/", command: "true", args: [] });
    expect(code).toBe(5);
  });

  test("spawnOnceHandle returns the live child alongside its exit promise", async () => {
    const proc = fakeProc([], 3);
    const mgr = makeManager(proc);
    const handle = mgr.spawnOnceHandle({ cwd: "/", command: "x", args: ["-y"] });
    expect(handle.proc).toBe(proc);
    handle.proc.kill();
    expect(proc.killed).toBe(true);
    expect(handle.exited).toBe(proc.exited);
  });
});
