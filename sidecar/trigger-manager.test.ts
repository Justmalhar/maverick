import { describe, test, expect } from "bun:test";
import { TriggerManager, parseInterval, type TriggerDeps } from "./trigger-manager";
import type { Automation } from "./types";

describe("parseInterval", () => {
  test("parses minutes, hours, days", () => {
    expect(parseInterval("30m")).toBe(1_800_000);
    expect(parseInterval("2h")).toBe(7_200_000);
    expect(parseInterval("1d")).toBe(86_400_000);
    expect(parseInterval(" 5m ")).toBe(300_000);
  });
  test("rejects invalid / zero / unsupported units", () => {
    expect(parseInterval("")).toBeNull();
    expect(parseInterval("x")).toBeNull();
    expect(parseInterval("0m")).toBeNull();
    expect(parseInterval("5s")).toBeNull();
    expect(parseInterval("m")).toBeNull();
  });
});

// Manual timer harness so tests drive scheduling without real time.
function makeHarness(automations: Automation[]) {
  let id = 0;
  const intervals = new Map<number, () => void>();
  const timeouts = new Map<number, () => void>();
  const runCalls: Array<{ projectPath: string; automationName: string; worktreePath: string }> = [];
  let resolveRun: (() => void) | null = null;
  const watchCalls: Array<{ worktreePath: string }> = [];
  let watchOnChange: (() => void) | null = null;
  let unwatchCount = 0;

  const deps: TriggerDeps = {
    loadAutomations: () => automations,
    runAutomation: (p) => {
      runCalls.push(p);
      return new Promise<void>((res) => {
        resolveRun = res;
      });
    },
    watch: (worktreePath, onChange) => {
      watchCalls.push({ worktreePath });
      watchOnChange = onChange;
      return () => {
        unwatchCount++;
      };
    },
    setInterval: (fn) => {
      const i = ++id;
      intervals.set(i, fn);
      return i as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval: (t) => {
      intervals.delete(t as unknown as number);
    },
    setTimeout: (fn) => {
      const i = ++id;
      timeouts.set(i, fn);
      return i as unknown as ReturnType<typeof setInterval>;
    },
    clearTimeout: (t) => {
      timeouts.delete(t as unknown as number);
    },
  };

  return {
    deps,
    intervals,
    timeouts,
    runCalls,
    watchCalls,
    fireIntervals: () => [...intervals.values()].forEach((fn) => fn()),
    fireTimeouts: () => [...timeouts.values()].forEach((fn) => fn()),
    emitChange: () => watchOnChange?.(),
    finishRun: () => resolveRun?.(),
    unwatchCount: () => unwatchCount,
  };
}

const SCHEDULE: Automation = { name: "sched", trigger: "schedule", interval: "30m", steps: [] };
const ONCHANGE: Automation = { name: "watch", trigger: "on-file-change", steps: [] };

describe("TriggerManager", () => {
  test("schedule trigger starts an interval that runs the automation", () => {
    const h = makeHarness([SCHEDULE]);
    new TriggerManager(h.deps).activate({ workspaceId: "w1", projectPath: "/p", worktreePath: "/wt" });
    expect(h.intervals.size).toBe(1);
    h.fireIntervals();
    expect(h.runCalls).toEqual([{ projectPath: "/p", automationName: "sched", worktreePath: "/wt" }]);
  });

  test("schedule with invalid interval is skipped", () => {
    const h = makeHarness([{ name: "bad", trigger: "schedule", interval: "nope", steps: [] }]);
    new TriggerManager(h.deps).activate({ workspaceId: "w1", projectPath: "/p", worktreePath: "/wt" });
    expect(h.intervals.size).toBe(0);
  });

  test("manual trigger registers nothing", () => {
    const h = makeHarness([{ name: "m", trigger: "manual", steps: [] }]);
    new TriggerManager(h.deps).activate({ workspaceId: "w1", projectPath: "/p", worktreePath: "/wt" });
    expect(h.intervals.size).toBe(0);
    expect(h.watchCalls.length).toBe(0);
  });

  test("on-file-change watches and runs debounced", () => {
    const h = makeHarness([ONCHANGE]);
    new TriggerManager(h.deps).activate({ workspaceId: "w1", projectPath: "/p", worktreePath: "/wt" });
    expect(h.watchCalls).toEqual([{ worktreePath: "/wt" }]);
    // Two rapid changes collapse to a single debounced run.
    h.emitChange();
    h.emitChange();
    expect(h.timeouts.size).toBe(1);
    h.fireTimeouts();
    expect(h.runCalls.length).toBe(1);
    expect(h.runCalls[0].automationName).toBe("watch");
  });

  test("overlap guard skips a concurrent run", () => {
    const h = makeHarness([SCHEDULE]);
    new TriggerManager(h.deps).activate({ workspaceId: "w1", projectPath: "/p", worktreePath: "/wt" });
    h.fireIntervals(); // run 1 starts, stays in flight (promise unresolved)
    h.fireIntervals(); // run 2 skipped
    expect(h.runCalls.length).toBe(1);
    h.finishRun();
  });

  test("deactivate clears intervals, watchers, and pending debounce", () => {
    const h = makeHarness([SCHEDULE, ONCHANGE]);
    const mgr = new TriggerManager(h.deps);
    mgr.activate({ workspaceId: "w1", projectPath: "/p", worktreePath: "/wt" });
    h.emitChange(); // arm a debounce
    expect(h.intervals.size).toBe(1);
    expect(h.timeouts.size).toBe(1);
    mgr.deactivate("w1");
    expect(h.intervals.size).toBe(0);
    expect(h.timeouts.size).toBe(0);
    expect(h.unwatchCount()).toBe(1);
  });

  test("activate is idempotent — re-activate replaces prior handles", () => {
    const h = makeHarness([SCHEDULE]);
    const mgr = new TriggerManager(h.deps);
    mgr.activate({ workspaceId: "w1", projectPath: "/p", worktreePath: "/wt" });
    mgr.activate({ workspaceId: "w1", projectPath: "/p", worktreePath: "/wt" });
    expect(h.intervals.size).toBe(1); // old interval cleared, one fresh interval
  });

  test("loadAutomations throwing does not crash activate", () => {
    const h = makeHarness([]);
    const deps: TriggerDeps = {
      ...h.deps,
      loadAutomations: () => {
        throw new Error("no config");
      },
    };
    expect(() =>
      new TriggerManager(deps).activate({ workspaceId: "w1", projectPath: "/p", worktreePath: "/wt" }),
    ).not.toThrow();
    expect(h.intervals.size).toBe(0);
  });

  test("deactivate of an unknown workspace is a no-op", () => {
    const h = makeHarness([]);
    expect(() => new TriggerManager(h.deps).deactivate("nope")).not.toThrow();
  });
});
