import { describe, test, expect } from "bun:test";
import { Caffeinate } from "./caffeinate";
import type { ManagedProc, Spawner } from "./process-manager";

function fakeProc(): ManagedProc & { killed: boolean } {
  let resolveExited!: (n: number) => void;
  const exited = new Promise<number>((r) => (resolveExited = r));
  const p = {
    exitCode: null as number | null,
    exited,
    killed: false,
    kill() {
      this.killed = true;
      resolveExited(0);
    },
  } as ManagedProc & { killed: boolean };
  return p;
}

describe("Caffeinate", () => {
  test("start on darwin spawns caffeinate", () => {
    const calls: string[][] = [];
    const proc = fakeProc();
    const spawner: Spawner = (cmd) => {
      calls.push(cmd);
      return proc;
    };
    const c = new Caffeinate({ spawn: spawner, platform: "darwin" });
    expect(c.start()).toEqual({ started: true });
    expect(calls[0]).toEqual(["caffeinate", "-i"]);
    expect(c.active()).toBe(true);
  });

  test("start on linux spawns systemd-inhibit", () => {
    const calls: string[][] = [];
    const spawner: Spawner = (cmd) => {
      calls.push(cmd);
      return fakeProc();
    };
    const c = new Caffeinate({ spawn: spawner, platform: "linux" });
    expect(c.start().started).toBe(true);
    expect(calls[0][0]).toBe("systemd-inhibit");
  });

  test("start is no-op when already active", () => {
    const c = new Caffeinate({ spawn: () => fakeProc(), platform: "darwin" });
    c.start();
    expect(c.start()).toEqual({ started: false });
  });

  test("start on win32 holds the execution state via a long-lived PowerShell process (#35)", () => {
    const calls: string[][] = [];
    const c = new Caffeinate({
      spawn: (cmd) => {
        calls.push(cmd);
        return fakeProc();
      },
      platform: "win32",
    });
    expect(c.start()).toEqual({ started: true });
    expect(c.active()).toBe(true);
    expect(calls[0][0]).toBe("powershell");
    expect(calls[0].join(" ")).toContain("SetThreadExecutionState");
  });

  test("stop kills and clears proc", () => {
    const proc = fakeProc();
    const c = new Caffeinate({ spawn: () => proc, platform: "darwin" });
    c.start();
    expect(c.stop()).toEqual({ stopped: true });
    expect(proc.killed).toBe(true);
    expect(c.active()).toBe(false);
  });

  test("stop is no-op when not started", () => {
    const c = new Caffeinate({ spawn: () => fakeProc(), platform: "darwin" });
    expect(c.stop()).toEqual({ stopped: false });
  });

  test("active() becomes false when the keep-awake process exits on its own (#40k)", async () => {
    let resolveExit!: (n: number) => void;
    const proc = {
      exitCode: null,
      exited: new Promise<number>((r) => (resolveExit = r)),
      kill() {},
    } as unknown as ManagedProc;
    const c = new Caffeinate({ spawn: () => proc, platform: "darwin" });
    c.start();
    expect(c.active()).toBe(true);
    resolveExit(0); // the process dies without stop() being called
    await Promise.resolve();
    await Promise.resolve();
    expect(c.active()).toBe(false);
  });

  test("default constructor builds without DI", () => {
    expect(new Caffeinate()).toBeInstanceOf(Caffeinate);
  });
});
