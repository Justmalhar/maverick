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

function makeManager(proc: ManagedProc) {
  const spawner: Spawner = () => proc;
  return new ProcessManager({ spawn: spawner });
}

describe("ProcessManager", () => {
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
