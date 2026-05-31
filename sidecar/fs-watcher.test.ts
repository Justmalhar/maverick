import { describe, test, expect } from "bun:test";
import { FsWatcher, isSkippedName, SKIP_DIRS } from "./fs-watcher";
import type { Notifier } from "./types";

interface FakeWatcher {
  path: string;
  fire: (event: string, filename: string | null) => void;
  closed: boolean;
}

function makeHarness(opts: { debounceMs?: number; maxWindowMs?: number } = {}) {
  const lines: string[] = [];
  const notifier: Notifier = { write: (l) => lines.push(l) };
  const watchers: FakeWatcher[] = [];
  let clock = 0;
  const errorThrows = new Set<string>();

  const watch = (
    path: string,
    listener: (event: string, filename: string | null) => void
  ) => {
    if (errorThrows.has(path)) throw new Error("watch failed");
    const w: FakeWatcher = {
      path,
      fire: (event, filename) => listener(event, filename),
      closed: false,
    };
    watchers.push(w);
    return {
      close() {
        w.closed = true;
      },
      on() {
        return this;
      },
    } as never;
  };

  const fw = new FsWatcher({
    notifier,
    watch,
    debounceMs: opts.debounceMs ?? 150,
    maxWindowMs: opts.maxWindowMs ?? 1000,
    now: () => clock,
  });

  return {
    fw,
    lines,
    watchers,
    advance: (ms: number) => {
      clock += ms;
    },
    failWatch: (path: string) => errorThrows.add(path),
    notifications: () => lines.map((l) => JSON.parse(l)),
  };
}

describe("isSkippedName", () => {
  test("matches deny-list basenames", () => {
    expect(isSkippedName("node_modules")).toBe(true);
    expect(isSkippedName(".git")).toBe(true);
    expect(isSkippedName("target")).toBe(true);
    expect(isSkippedName("dist")).toBe(true);
    expect(isSkippedName("src")).toBe(false);
  });

  test("SKIP_DIRS contains the canonical heavy dirs", () => {
    expect(SKIP_DIRS.has("node_modules")).toBe(true);
    expect(SKIP_DIRS.has(".maverick")).toBe(true);
  });
});

describe("FsWatcher", () => {
  test("default constructor builds without DI", () => {
    expect(new FsWatcher()).toBeInstanceOf(FsWatcher);
  });

  test("start watches the root and reports the count", () => {
    const h = makeHarness();
    const r = h.fw.start({ root: "/wt" });
    expect(r.watching).toBe(1);
    expect(h.watchers[0].path).toBe("/wt");
  });

  test("start includes pre-expanded dirs", () => {
    const h = makeHarness();
    const r = h.fw.start({ root: "/wt", dirs: ["/wt/src", "/wt/lib"] });
    expect(r.watching).toBe(3);
    expect(h.watchers.map((w) => w.path).sort()).toEqual(["/wt", "/wt/lib", "/wt/src"]);
  });

  test("skips deny-listed directories on start", () => {
    const h = makeHarness();
    const r = h.fw.start({ root: "/wt", dirs: ["/wt/node_modules", "/wt/src"] });
    expect(r.watching).toBe(2);
    expect(h.watchers.some((w) => w.path === "/wt/node_modules")).toBe(false);
  });

  test("coalesces a burst into a single debounced notification", async () => {
    // Tight real debounce; the fake clock only governs the max-window math, so a
    // 10ms burst inside one window must collapse to exactly ONE emission.
    const h = makeHarness({ debounceMs: 10, maxWindowMs: 1000 });
    h.fw.start({ root: "/wt" });
    const w = h.watchers[0];
    w.fire("change", "a.ts");
    h.advance(2);
    w.fire("change", "b.ts");
    h.advance(2);
    w.fire("change", "a.ts");
    // Within the debounce gap (and well under the max window): no flush yet.
    expect(h.lines.length).toBe(0);
    await Bun.sleep(25);
    const notes = h.notifications();
    expect(notes.length).toBe(1);
    expect(notes[0].method).toBe("fs.changed");
    expect(notes[0].params.paths.sort()).toEqual(["/wt/a.ts", "/wt/b.ts"]);
  });

  test("emits a single fs.changed with the union of paths", async () => {
    const h = makeHarness({ debounceMs: 10 });
    h.fw.start({ root: "/wt" });
    const w = h.watchers[0];
    w.fire("change", "a.ts");
    w.fire("change", "b.ts");
    w.fire("change", "a.ts");
    await Bun.sleep(20);
    const notes = h.notifications();
    expect(notes.length).toBe(1);
    expect(notes[0].method).toBe("fs.changed");
    expect(notes[0].params.root).toBe("/wt");
    expect(notes[0].params.paths.sort()).toEqual(["/wt/a.ts", "/wt/b.ts"]);
  });

  test("drops events for skipped sub-paths", async () => {
    const h = makeHarness({ debounceMs: 10 });
    h.fw.start({ root: "/wt" });
    const w = h.watchers[0];
    w.fire("change", "node_modules");
    await Bun.sleep(20);
    expect(h.lines.length).toBe(0);
  });

  test("uses the dir itself when no filename is reported", async () => {
    const h = makeHarness({ debounceMs: 10 });
    h.fw.start({ root: "/wt" });
    h.watchers[0].fire("rename", null);
    await Bun.sleep(20);
    expect(h.notifications()[0].params.paths).toEqual(["/wt"]);
  });

  test("max-window forces a flush during a sustained stream", async () => {
    // Real debounce is huge (5s) so the quiet-gap alone can never fire inside
    // the test. Events arrive every (fake) 100ms so the gap never elapses; once
    // the fake clock crosses maxWindowMs the scheduled delay is clamped to 0 and
    // the real timer flushes immediately — proving the cap, not the debounce.
    const h = makeHarness({ debounceMs: 5000, maxWindowMs: 1000 });
    h.fw.start({ root: "/wt" });
    const w = h.watchers[0];
    w.fire("change", "a.ts");
    for (let t = 100; t <= 1000; t += 100) {
      h.advance(100);
      w.fire("change", `f${t}.ts`);
    }
    // Clock is now at the max window; the most recent schedule() clamped its
    // delay to 0, so the queued flush fires on the next microtask/tick.
    await Bun.sleep(10);
    const notes = h.notifications();
    expect(notes.length).toBe(1);
    expect(notes[0].method).toBe("fs.changed");
    expect(notes[0].params.paths).toContain("/wt/a.ts");
    expect(notes[0].params.paths).toContain("/wt/f1000.ts");
  });

  test("add throws before start", () => {
    const h = makeHarness();
    expect(() => h.fw.add({ dirs: ["/x"] })).toThrow("fs.watch.add before fs.watch.start");
  });

  test("add and remove are refcounted", () => {
    const h = makeHarness();
    h.fw.start({ root: "/wt" });
    expect(h.fw.add({ dirs: ["/wt/src"] }).watching).toBe(2);
    // Second add of the same dir bumps refcount, not watcher count.
    expect(h.fw.add({ dirs: ["/wt/src"] }).watching).toBe(2);
    expect(h.watchers.filter((w) => w.path === "/wt/src").length).toBe(1);
    // One remove only drops the refcount, dir still watched.
    expect(h.fw.remove({ dirs: ["/wt/src"] }).watching).toBe(2);
    // Final remove releases it.
    expect(h.fw.remove({ dirs: ["/wt/src"] }).watching).toBe(1);
  });

  test("releasing the last refcount closes the underlying watcher", () => {
    const h = makeHarness();
    h.fw.start({ root: "/wt" });
    h.fw.add({ dirs: ["/wt/src"] });
    const watcher = h.watchers.find((w) => w.path === "/wt/src");
    expect(watcher).toBeDefined();
    expect(watcher!.closed).toBe(false);
    // Final release: refcount hits zero, the FSWatcher must be closed and the
    // dir removed so a re-add creates a fresh watcher rather than reusing a leak.
    h.fw.remove({ dirs: ["/wt/src"] });
    expect(watcher!.closed).toBe(true);
    // The map shrank: re-adding the same dir spins up a brand-new watcher.
    h.fw.add({ dirs: ["/wt/src"] });
    const after = h.watchers.filter((w) => w.path === "/wt/src");
    expect(after.length).toBe(2);
    expect(after[1].closed).toBe(false);
  });

  test("a refcount drop above zero leaves the watcher open", () => {
    const h = makeHarness();
    h.fw.start({ root: "/wt" });
    h.fw.add({ dirs: ["/wt/src"] });
    h.fw.add({ dirs: ["/wt/src"] });
    const watcher = h.watchers.find((w) => w.path === "/wt/src")!;
    h.fw.remove({ dirs: ["/wt/src"] });
    // Still one requester left — watcher stays open.
    expect(watcher.closed).toBe(false);
    h.fw.remove({ dirs: ["/wt/src"] });
    expect(watcher.closed).toBe(true);
  });

  test("a close() that throws during remove is tolerated", () => {
    const lines: string[] = [];
    const notifier: Notifier = { write: (l) => lines.push(l) };
    const fw = new FsWatcher({
      notifier,
      watch: () =>
        ({
          close() {
            throw new Error("close boom");
          },
          on() {
            return this;
          },
        }) as never,
      now: () => 0,
    });
    fw.start({ root: "/wt", dirs: ["/wt/src"] });
    // remove triggers close() which throws; must be swallowed.
    expect(fw.remove({ dirs: ["/wt/src"] }).watching).toBe(1);
  });

  test("remove of an unknown dir is a no-op", () => {
    const h = makeHarness();
    h.fw.start({ root: "/wt" });
    expect(h.fw.remove({ dirs: ["/nope"] }).watching).toBe(1);
  });

  test("remove without a session returns zero", () => {
    const h = makeHarness();
    expect(h.fw.remove({ dirs: ["/x"] }).watching).toBe(0);
  });

  test("switching roots tears down the old session", () => {
    const h = makeHarness();
    h.fw.start({ root: "/a", dirs: ["/a/src"] });
    const oldWatchers = [...h.watchers];
    h.fw.start({ root: "/b" });
    expect(oldWatchers.every((w) => w.closed)).toBe(true);
    expect(h.watchers.filter((w) => !w.closed).map((w) => w.path)).toEqual(["/b"]);
  });

  test("stop closes watchers and is idempotent", () => {
    const h = makeHarness();
    h.fw.start({ root: "/wt", dirs: ["/wt/src"] });
    expect(h.fw.stop().ok).toBe(true);
    expect(h.watchers.every((w) => w.closed)).toBe(true);
    // Second stop on an empty session.
    expect(h.fw.stop().ok).toBe(true);
  });

  test("a failing watch() call is swallowed", () => {
    const h = makeHarness();
    h.failWatch("/wt/bad");
    h.fw.start({ root: "/wt", dirs: ["/wt/bad"] });
    // Root watched, bad dir skipped silently.
    expect(h.watchers.map((w) => w.path)).toEqual(["/wt"]);
  });

  test("events after stop do not throw or emit", async () => {
    const h = makeHarness({ debounceMs: 10 });
    h.fw.start({ root: "/wt" });
    const w = h.watchers[0];
    h.fw.stop();
    w.fire("change", "a.ts");
    await Bun.sleep(20);
    expect(h.lines.length).toBe(0);
  });

  test("close() that throws is tolerated", () => {
    const lines: string[] = [];
    const notifier: Notifier = { write: (l) => lines.push(l) };
    const fw = new FsWatcher({
      notifier,
      watch: () =>
        ({
          close() {
            throw new Error("close boom");
          },
          on() {
            return this;
          },
        }) as never,
      now: () => 0,
    });
    fw.start({ root: "/wt" });
    expect(fw.stop().ok).toBe(true);
  });
});
