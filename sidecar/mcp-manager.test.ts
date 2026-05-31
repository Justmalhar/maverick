import { describe, test, expect } from "bun:test";
import { MCPManager } from "./mcp-manager";
import { ConfigLoader } from "./config-loader";
import type { ManagedProc, Spawner } from "./process-manager";

interface FakeProc extends ManagedProc {
  killed: boolean;
  resolveExit: (code: number) => void;
}

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(enc.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
}

function fakeProc(
  opts: { exitCode?: number | null; stdout?: string[]; stderr?: string[] } = {}
): FakeProc {
  let resolveExit!: (code: number) => void;
  const exited =
    opts.exitCode === undefined
      ? new Promise<number>((res) => {
          resolveExit = res;
        })
      : Promise.resolve(opts.exitCode ?? 0);
  return {
    exitCode: opts.exitCode ?? null,
    exited,
    stdout: opts.stdout ? streamOf(opts.stdout) : undefined,
    stderr: opts.stderr ? streamOf(opts.stderr) : undefined,
    killed: false,
    resolveExit: resolveExit ?? (() => {}),
    kill() {
      this.killed = true;
    },
  } as FakeProc;
}

function loaderWith(mcps: unknown[]): ConfigLoader {
  return new ConfigLoader({
    read: () =>
      JSON.stringify({
        version: 1,
        backends: { default: "claude", available: [] },
        mcps,
      }),
    exists: () => true,
  });
}

const FS = [{ name: "fs", command: "mcp-fs", args: ["--port", "1"] }];

describe("MCPManager", () => {
  test("start spawns server based on config", () => {
    const loader = loaderWith(FS);
    const spawner: Spawner = () => Object.assign(fakeProc(), { pid: 1234 }) as ManagedProc;
    const mgr = new MCPManager({ spawn: spawner, loader, projectPath: "/r", notifier: { write() {} } });
    const r = mgr.start("fs");
    expect(r.pid).toBe(1234);
    expect(mgr.list()[0].name).toBe("fs");
    expect(mgr.list()[0].restarts).toBe(0);
  });

  test("start is idempotent for a running server", () => {
    const loader = loaderWith([{ name: "fs", command: "mcp-fs", args: [] }]);
    const proc = fakeProc();
    const spawner: Spawner = () => Object.assign(proc, { pid: 7 }) as ManagedProc;
    const mgr = new MCPManager({ spawn: spawner, loader, projectPath: "/r", notifier: { write() {} } });
    mgr.start("fs");
    const r = mgr.start("fs");
    expect(r.pid).toBe(7);
  });

  test("start without projectPath throws", () => {
    const mgr = new MCPManager({ spawn: () => fakeProc(), loader: loaderWith([]) });
    expect(() => mgr.start("x")).toThrow(/projectPath not set/);
  });

  test("setProjectPath updates project path", () => {
    const mgr = new MCPManager({ spawn: () => fakeProc(), loader: loaderWith([]) });
    mgr.setProjectPath("/r");
    expect(() => mgr.start("missing")).toThrow(/not configured/);
  });

  test("stop kills proc and removes entry", () => {
    const loader = loaderWith([{ name: "fs", command: "mcp-fs", args: [] }]);
    const proc = fakeProc();
    const mgr = new MCPManager({
      spawn: () => Object.assign(proc, { pid: 9 }) as ManagedProc,
      loader,
      projectPath: "/r",
      notifier: { write() {} },
    });
    mgr.start("fs");
    expect(mgr.stop("fs").ok).toBe(true);
    expect(proc.killed).toBe(true);
    expect(mgr.list()).toHaveLength(0);
  });

  test("stop is a no-op on an unknown server", () => {
    const mgr = new MCPManager({ spawn: () => fakeProc(), loader: loaderWith([]) });
    expect(mgr.stop("ghost").ok).toBe(true);
  });

  test("health reports stopped for unknown server", () => {
    const mgr = new MCPManager({ spawn: () => fakeProc(), loader: loaderWith([]) });
    expect(mgr.health("missing")).toBe("stopped");
  });

  test("health reports running for a live proc", () => {
    const loader = loaderWith([{ name: "a", command: "x", args: [] }]);
    const mgr = new MCPManager({
      spawn: () => Object.assign(fakeProc(), { pid: 1 }) as ManagedProc,
      loader,
      projectPath: "/r",
      notifier: { write() {} },
    });
    mgr.start("a");
    expect(mgr.health("a")).toBe("running");
  });

  test("captures stdout and stderr into the log ring", async () => {
    const loader = loaderWith([{ name: "a", command: "x", args: [] }]);
    const proc = fakeProc({ stdout: ["out-line\n"], stderr: ["err-line\n"] });
    const mgr = new MCPManager({
      spawn: () => Object.assign(proc, { pid: 1 }) as ManagedProc,
      loader,
      projectPath: "/r",
      notifier: { write() {} },
    });
    mgr.start("a");
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 5));
    const page = mgr.logs("a", 0);
    expect(page.data).toContain("out-line");
    expect(page.data).toContain("err-line");
    expect(page.nextOffset).toBeGreaterThan(0);
  });

  test("logs returns an empty page for an unknown server", () => {
    const mgr = new MCPManager({ spawn: () => fakeProc(), loader: loaderWith([]) });
    expect(mgr.logs("ghost")).toEqual({ data: "", nextOffset: 0, dropped: 0 });
  });

  test("auto-restarts on unexpected exit after the backoff window", async () => {
    const loader = loaderWith([{ name: "a", command: "x", args: [] }]);
    let now = 0;
    const status: unknown[] = [];
    const notifier = {
      write(line: string) {
        status.push(JSON.parse(line).params);
      },
    };
    let spawnCount = 0;
    const procs: FakeProc[] = [];
    const mgr = new MCPManager({
      spawn: () => {
        spawnCount++;
        const p = fakeProc();
        procs.push(p);
        return Object.assign(p, { pid: spawnCount }) as ManagedProc;
      },
      loader,
      projectPath: "/r",
      notifier,
      now: () => now,
      baseBackoffMs: 1_000,
    });
    mgr.start("a");
    procs[0].resolveExit(1);
    await new Promise((r) => setTimeout(r, 5));
    expect(mgr.health("a")).toBe("restarting");
    expect(mgr.list()[0].restarts).toBe(1);

    // Before the backoff elapses, tick is a no-op.
    now = 500;
    mgr.tick();
    expect(spawnCount).toBe(1);

    // After the backoff, tick re-spawns.
    now = 1_000;
    mgr.tick();
    expect(spawnCount).toBe(2);
    expect(mgr.health("a")).toBe("running");
    expect(status.some((s) => (s as { status: string }).status === "restarting")).toBe(true);
  });

  test("gives up after the max-retry cap and marks the server crashed", async () => {
    const loader = loaderWith([{ name: "a", command: "x", args: [] }]);
    let now = 0;
    const procs: FakeProc[] = [];
    const mgr = new MCPManager({
      spawn: () => {
        const p = fakeProc();
        procs.push(p);
        return Object.assign(p, { pid: procs.length }) as ManagedProc;
      },
      loader,
      projectPath: "/r",
      notifier: { write() {} },
      now: () => now,
      maxRetries: 2,
      baseBackoffMs: 1,
    });
    mgr.start("a");
    // Crash twice (consumes the budget), each time advancing the clock.
    for (let i = 0; i < 2; i++) {
      procs[procs.length - 1].resolveExit(1);
      await new Promise((r) => setTimeout(r, 5));
      now += 10_000;
      mgr.tick();
    }
    // Third crash exceeds maxRetries → crashed, no further restart.
    procs[procs.length - 1].resolveExit(1);
    await new Promise((r) => setTimeout(r, 5));
    expect(mgr.health("a")).toBe("crashed");
    const before = procs.length;
    now += 10_000;
    mgr.tick();
    expect(procs.length).toBe(before);
  });

  test("a deliberate stop does not auto-restart", async () => {
    const loader = loaderWith([{ name: "a", command: "x", args: [] }]);
    const proc = fakeProc();
    let spawnCount = 0;
    const mgr = new MCPManager({
      spawn: () => {
        spawnCount++;
        return Object.assign(proc, { pid: 1 }) as ManagedProc;
      },
      loader,
      projectPath: "/r",
      notifier: { write() {} },
    });
    mgr.start("a");
    mgr.stop("a");
    proc.resolveExit(1);
    await new Promise((r) => setTimeout(r, 5));
    mgr.tick();
    expect(spawnCount).toBe(1);
    expect(mgr.health("a")).toBe("stopped");
  });

  test("a late exit from a replaced generation is ignored", async () => {
    const loader = loaderWith([{ name: "a", command: "x", args: [] }]);
    const first = fakeProc();
    let n = 0;
    const mgr = new MCPManager({
      spawn: () => (n++ === 0 ? Object.assign(first, { pid: 1 }) : Object.assign(fakeProc(), { pid: 2 })) as ManagedProc,
      loader,
      projectPath: "/r",
      notifier: { write() {} },
      now: () => 0,
      baseBackoffMs: 0,
    });
    mgr.start("a");
    // Crash, then restart via tick → generation advances.
    first.resolveExit(1);
    await new Promise((r) => setTimeout(r, 5));
    mgr.tick();
    expect(mgr.health("a")).toBe("running");
    // first.exited already resolved; its stale handler must not flip status.
    await new Promise((r) => setTimeout(r, 5));
    expect(mgr.health("a")).toBe("running");
  });

  test("list maps live and exited servers", async () => {
    const loader = loaderWith([
      { name: "a", command: "x", args: [] },
      { name: "b", command: "x", args: [] },
    ]);
    const running = fakeProc();
    const exitedZero = fakeProc({ exitCode: 0 });
    const procs = [running, exitedZero];
    let i = 0;
    const mgr = new MCPManager({
      spawn: () => Object.assign(procs[i], { pid: ++i }) as ManagedProc,
      loader,
      projectPath: "/r",
      notifier: { write() {} },
      // Disable restart so b stays observable as stopped.
      maxRetries: 0,
    });
    mgr.start("a");
    mgr.start("b");
    await new Promise((r) => setTimeout(r, 5));
    const list = mgr.list();
    expect(list.find((s) => s.name === "a")?.status).toBe("running");
    expect(list.find((s) => s.name === "b")?.status).toBe("crashed");
  });

  test("default constructor builds without DI", () => {
    expect(new MCPManager()).toBeInstanceOf(MCPManager);
  });

  test("uses the default clock and notifier when not injected", async () => {
    const loader = loaderWith([{ name: "a", command: "x", args: [] }]);
    const proc = fakeProc();
    // Inject only the spawner so the default now()/stdoutNotifier run; route
    // stdout writes through a spy to keep the test quiet and assertable.
    const written: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
      written.push(s);
      return true;
    };
    try {
      const mgr = new MCPManager({
        spawn: () => Object.assign(proc, { pid: 1 }) as ManagedProc,
        loader,
        projectPath: "/r",
        maxRetries: 1,
        baseBackoffMs: 0,
      });
      mgr.start("a");
      proc.resolveExit(1);
      await new Promise((r) => setTimeout(r, 5));
      // Default now() (Date.now) ⇒ backoff window of 0 already elapsed.
      mgr.tick();
      expect(written.some((l) => l.includes("mcp.status"))).toBe(true);
    } finally {
      (process.stdout as unknown as { write: typeof original }).write = original;
    }
  });
});
