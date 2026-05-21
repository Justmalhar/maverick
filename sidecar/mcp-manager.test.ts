import { describe, test, expect } from "bun:test";
import { MCPManager } from "./mcp-manager";
import { ConfigLoader } from "./config-loader";
import type { ManagedProc, Spawner } from "./process-manager";

function fakeProc(exitCode: number | null = null): ManagedProc & { killed: boolean } {
  return {
    exitCode,
    exited: Promise.resolve(exitCode ?? 0),
    killed: false,
    kill() {
      this.killed = true;
    },
  } as ManagedProc & { killed: boolean };
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

describe("MCPManager", () => {
  test("start spawns server based on config", () => {
    const loader = loaderWith([{ name: "fs", command: "mcp-fs", args: ["--port", "1"] }]);
    const proc = fakeProc();
    const spawner: Spawner = () => Object.assign(proc, { pid: 1234 }) as ManagedProc;
    const mgr = new MCPManager({ spawn: spawner, loader, projectPath: "/r" });
    const r = mgr.start("fs");
    expect(r.pid).toBe(1234);
    expect(mgr.list()[0].name).toBe("fs");
  });

  test("start is idempotent for running server", () => {
    const loader = loaderWith([{ name: "fs", command: "mcp-fs", args: [] }]);
    const proc = fakeProc();
    const spawner: Spawner = () => Object.assign(proc, { pid: 7 }) as ManagedProc;
    const mgr = new MCPManager({ spawn: spawner, loader, projectPath: "/r" });
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
    });
    mgr.start("fs");
    expect(mgr.stop("fs").ok).toBe(true);
    expect(proc.killed).toBe(true);
    expect(mgr.list()).toHaveLength(0);
  });

  test("stop is no-op on unknown server", () => {
    const mgr = new MCPManager({ spawn: () => fakeProc(), loader: loaderWith([]) });
    expect(mgr.stop("ghost").ok).toBe(true);
  });

  test("health reports stopped/running/error", () => {
    const loader = loaderWith([
      { name: "a", command: "x", args: [] },
      { name: "b", command: "x", args: [] },
      { name: "c", command: "x", args: [] },
    ]);
    const runningProc = fakeProc();
    const exitedZero = fakeProc(0);
    const exitedNonZero = fakeProc(2);
    const procs = [runningProc, exitedZero, exitedNonZero];
    let i = 0;
    const mgr = new MCPManager({
      spawn: () => Object.assign(procs[i++], { pid: i }) as ManagedProc,
      loader,
      projectPath: "/r",
    });
    mgr.start("a");
    mgr.start("b");
    mgr.start("c");
    expect(mgr.health("a")).toBe("running");
    expect(mgr.health("b")).toBe("stopped");
    expect(mgr.health("c")).toBe("error");
    expect(mgr.health("missing")).toBe("stopped");
  });

  test("list maps to MCPServer status", () => {
    const loader = loaderWith([
      { name: "a", command: "x", args: [] },
      { name: "b", command: "x", args: [] },
    ]);
    const running = fakeProc();
    const stopped = fakeProc(0);
    const procs = [running, stopped];
    let i = 0;
    const mgr = new MCPManager({
      spawn: () => Object.assign(procs[i++], { pid: i }) as ManagedProc,
      loader,
      projectPath: "/r",
    });
    mgr.start("a");
    mgr.start("b");
    const list = mgr.list();
    expect(list.find((s) => s.name === "a")?.status).toBe("running");
    expect(list.find((s) => s.name === "b")?.status).toBe("stopped");
  });

  test("default constructor builds without DI", () => {
    expect(new MCPManager()).toBeInstanceOf(MCPManager);
  });
});
