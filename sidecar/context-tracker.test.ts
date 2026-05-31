import { describe, test, expect } from "bun:test";
import { ContextTracker } from "./context-tracker";
import { SQLiteStore, defaultMigrationsDir } from "./sqlite-store";

function makeStore() {
  let n = 0;
  const ids = {
    uuid: (p: string) => `${p}_${++n}`,
    now: () => 1_700_000_000_000 + n,
  };
  const store = new SQLiteStore({ path: ":memory:", migrationsDir: defaultMigrationsDir(), ids });
  return { store, ids };
}

describe("ContextTracker", () => {
  test("usage returns defaults when no row", () => {
    const { store, ids } = makeStore();
    const tracker = new ContextTracker(store, { ids });
    const u = tracker.usage("nope");
    expect(u.tokensUsed).toBe(0);
    expect(u.contextWindow).toBe(200000);
    expect(u.workspaceId).toBe("");
  });

  test("update inserts a new row and usage reads it", () => {
    const { store, ids } = makeStore();
    const proj = store.projectAdd({ path: "/r" });
    const ws = store.workspaceCreate({
      projectId: proj.id,
      branch: "main",
      agentBackend: "claude",
      worktreePath: "/wt",
    });
    const tracker = new ContextTracker(store, { ids });
    tracker.update(ws.sessionId, 100, 0.01);
    const u = tracker.usage(ws.sessionId);
    expect(u.tokensUsed).toBe(100);
    expect(u.sessionCostEstimate).toBeCloseTo(0.01);
    expect(u.workspaceId).toBe(ws.id);
  });

  test("update accumulates cost on existing row", () => {
    const { store, ids } = makeStore();
    const proj = store.projectAdd({ path: "/r" });
    const ws = store.workspaceCreate({
      projectId: proj.id,
      branch: "main",
      agentBackend: "claude",
      worktreePath: "/wt",
    });
    const tracker = new ContextTracker(store, { ids });
    tracker.update(ws.sessionId, 100, 0.01);
    tracker.update(ws.sessionId, 200, 0.02);
    const u = tracker.usage(ws.sessionId);
    expect(u.tokensUsed).toBe(200);
    expect(u.sessionCostEstimate).toBeCloseTo(0.03);
  });

  test("respects defaultWindow option", () => {
    const { store, ids } = makeStore();
    const tracker = new ContextTracker(store, { ids, defaultWindow: 50_000 });
    expect(tracker.usage("anything").contextWindow).toBe(50_000);
  });

  test("record sets absolute token + cost figures (upsert)", () => {
    const { store, ids } = makeStore();
    const proj = store.projectAdd({ path: "/r" });
    const ws = store.workspaceCreate({
      projectId: proj.id,
      branch: "main",
      agentBackend: "claude",
      worktreePath: "/wt",
    });
    const tracker = new ContextTracker(store, { ids });

    const first = tracker.record(ws.sessionId, 500, 0.05);
    expect(first.tokensUsed).toBe(500);
    expect(first.sessionCostEstimate).toBeCloseTo(0.05);

    // record overwrites (absolute) rather than accumulating like update.
    const second = tracker.record(ws.sessionId, 1200, 0.12);
    expect(second.tokensUsed).toBe(1200);
    expect(second.sessionCostEstimate).toBeCloseTo(0.12);
    expect(tracker.usage(ws.sessionId).tokensUsed).toBe(1200);
  });
});
