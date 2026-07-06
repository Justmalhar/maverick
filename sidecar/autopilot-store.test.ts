import { describe, test, expect, beforeEach } from "bun:test";
import { SQLiteStore, defaultMigrationsDir } from "./sqlite-store";
import { AutopilotStore } from "./autopilot-store";

function makeStore() {
  let n = 0;
  const ids = {
    uuid: (p: string) => `${p}_${++n}`,
    now: () => 1_700_000_000_000 + n * 1000,
  };
  const store = new SQLiteStore({ path: ":memory:", migrationsDir: defaultMigrationsDir(), ids });
  const autopilots = new AutopilotStore(store, { ids });
  const proj = store.projectAdd({ path: "/tmp/a" });
  return { store, autopilots, proj, ids };
}

describe("AutopilotStore", () => {
  let env = makeStore();

  beforeEach(() => {
    env = makeStore();
  });

  test("upsert inserts a new autopilot with defaults", () => {
    const a = env.autopilots.upsert({ projectId: env.proj.id, name: "nightly" });
    expect(a.id.startsWith("autopilot_")).toBe(true);
    expect(a.enabled).toBe(true);
    expect(a.intervalMinutes).toBeNull();
    expect(a.lastStatus).toBe("never");
    expect(a.lastRunAt).toBeNull();
  });

  test("upsert respects provided id and updates existing", () => {
    const a1 = env.autopilots.upsert({ projectId: env.proj.id, name: "first" });
    const a2 = env.autopilots.upsert({ id: a1.id, projectId: env.proj.id, name: "renamed", enabled: false });
    expect(a2.id).toBe(a1.id);
    expect(a2.name).toBe("renamed");
    expect(a2.enabled).toBe(false);
    expect(env.autopilots.list(env.proj.id)).toHaveLength(1);
  });

  test("list returns all autopilots for a project", () => {
    env.autopilots.upsert({ projectId: env.proj.id, name: "a" });
    env.autopilots.upsert({ projectId: env.proj.id, name: "b" });
    expect(env.autopilots.list(env.proj.id)).toHaveLength(2);
  });

  test("list('') returns autopilots from all projects", () => {
    const proj2 = env.store.projectAdd({ path: "/tmp/a2" });
    env.autopilots.upsert({ projectId: env.proj.id, name: "p1" });
    env.autopilots.upsert({ projectId: proj2.id, name: "p2" });
    expect(env.autopilots.list("")).toHaveLength(2);
  });

  test("get returns null for an unknown id", () => {
    expect(env.autopilots.get("nope")).toBeNull();
  });

  test("get returns the stored row", () => {
    const a = env.autopilots.upsert({ projectId: env.proj.id, name: "x", backend: "claude", branch: "main", prompt: "do it" });
    const fetched = env.autopilots.get(a.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.backend).toBe("claude");
    expect(fetched?.prompt).toBe("do it");
  });

  test("delete removes an autopilot", () => {
    const a = env.autopilots.upsert({ projectId: env.proj.id, name: "x" });
    env.autopilots.delete(a.id);
    expect(env.autopilots.list(env.proj.id)).toHaveLength(0);
  });

  test("dueForCheck excludes disabled autopilots", () => {
    env.autopilots.upsert({ projectId: env.proj.id, name: "x", intervalMinutes: 5, enabled: false });
    expect(env.autopilots.dueForCheck(9_999_999)).toHaveLength(0);
  });

  test("dueForCheck excludes manual-only autopilots (no intervalMinutes)", () => {
    env.autopilots.upsert({ projectId: env.proj.id, name: "x", intervalMinutes: null });
    expect(env.autopilots.dueForCheck(9_999_999)).toHaveLength(0);
  });

  test("dueForCheck includes a never-run interval autopilot immediately", () => {
    env.autopilots.upsert({ projectId: env.proj.id, name: "x", intervalMinutes: 5 });
    expect(env.autopilots.dueForCheck(1_700_000)).toHaveLength(1);
  });

  test("dueForCheck excludes an interval autopilot whose interval has not elapsed", () => {
    const a = env.autopilots.upsert({ projectId: env.proj.id, name: "x", intervalMinutes: 5 });
    env.autopilots.markRun(a.id, { status: "ok" });
    const lastRunAt = env.autopilots.get(a.id)!.lastRunAt!;
    expect(env.autopilots.dueForCheck(lastRunAt + 60)).toHaveLength(0);
  });

  test("dueForCheck includes an interval autopilot once the interval has elapsed", () => {
    const a = env.autopilots.upsert({ projectId: env.proj.id, name: "x", intervalMinutes: 5 });
    env.autopilots.markRun(a.id, { status: "ok" });
    const lastRunAt = env.autopilots.get(a.id)!.lastRunAt!;
    expect(env.autopilots.dueForCheck(lastRunAt + 300)).toHaveLength(1);
  });

  test("markRun records ok status and clears any prior error", () => {
    const a = env.autopilots.upsert({ projectId: env.proj.id, name: "x" });
    env.autopilots.markRun(a.id, { status: "error", error: "boom" });
    env.autopilots.markRun(a.id, { status: "ok" });
    const fetched = env.autopilots.get(a.id)!;
    expect(fetched.lastStatus).toBe("ok");
    expect(fetched.lastError).toBeUndefined();
    expect(fetched.lastRunAt).not.toBeNull();
  });

  test("markRun records an error and message", () => {
    const a = env.autopilots.upsert({ projectId: env.proj.id, name: "x" });
    env.autopilots.markRun(a.id, { status: "error", error: "git worktree failed" });
    const fetched = env.autopilots.get(a.id)!;
    expect(fetched.lastStatus).toBe("error");
    expect(fetched.lastError).toBe("git worktree failed");
  });

  test("fromRow exposed for testing", () => {
    const row = {
      id: "autopilot_1",
      project_id: "p",
      name: "nightly",
      backend: "claude",
      branch: "main",
      prompt: "run tests",
      interval_minutes: 60,
      enabled: 1,
      last_run_at: null,
      last_status: "never",
      last_error: null,
      created_at: 1,
    };
    const a = AutopilotStore.fromRow(row);
    expect(a.enabled).toBe(true);
    expect(a.lastError).toBeUndefined();
    expect(a.intervalMinutes).toBe(60);
  });
});
