import { describe, test, expect, beforeEach } from "bun:test";
import { SQLiteStore, defaultMigrationsDir } from "./sqlite-store";
import { SquadStore } from "./squad-store";

function makeStore() {
  let n = 0;
  const ids = {
    uuid: (p: string) => `${p}_${++n}`,
    now: () => 1_700_000_000_000 + n * 1000,
  };
  const store = new SQLiteStore({ path: ":memory:", migrationsDir: defaultMigrationsDir(), ids });
  const squads = new SquadStore(store, { ids });
  const proj = store.projectAdd({ path: "/tmp/s" });
  return { store, squads, proj, ids };
}

describe("SquadStore", () => {
  let env = makeStore();

  beforeEach(() => {
    env = makeStore();
  });

  test("upsert inserts a new squad with no members", () => {
    const s = env.squads.upsert({ projectId: env.proj.id, name: "auth-refactor" });
    expect(s.id.startsWith("squad_")).toBe(true);
    expect(s.memberWorkspaceIds).toEqual([]);
    expect(s.leaderWorkspaceId).toBeUndefined();
  });

  test("upsert stores leader and members", () => {
    const ws1 = env.store.workspaceCreate({ projectId: env.proj.id, branch: "a", agentBackend: "claude", worktreePath: "/tmp/s/a" });
    const s = env.squads.upsert({
      projectId: env.proj.id,
      name: "auth-refactor",
      leaderWorkspaceId: ws1.id,
      memberWorkspaceIds: [ws1.id, "ws-2", "ws-3"],
    });
    expect(s.leaderWorkspaceId).toBe(ws1.id);
    expect(s.memberWorkspaceIds).toEqual([ws1.id, "ws-2", "ws-3"]);
  });

  test("upsert respects provided id and replaces membership", () => {
    const s1 = env.squads.upsert({
      projectId: env.proj.id,
      name: "squad",
      memberWorkspaceIds: ["ws-1", "ws-2"],
    });
    const s2 = env.squads.upsert({
      id: s1.id,
      projectId: env.proj.id,
      name: "squad",
      memberWorkspaceIds: ["ws-1"],
    });
    expect(s2.id).toBe(s1.id);
    expect(s2.memberWorkspaceIds).toEqual(["ws-1"]);
    expect(env.squads.list(env.proj.id)).toHaveLength(1);
  });

  test("upsert without a leader clears a previously set leader (full-replace semantics)", () => {
    const ws1 = env.store.workspaceCreate({ projectId: env.proj.id, branch: "a", agentBackend: "claude", worktreePath: "/tmp/s/a" });
    const s1 = env.squads.upsert({ projectId: env.proj.id, name: "squad", leaderWorkspaceId: ws1.id });
    const s2 = env.squads.upsert({ id: s1.id, projectId: env.proj.id, name: "squad" });
    expect(s2.leaderWorkspaceId).toBeUndefined();
  });

  test("list returns squads for a project", () => {
    env.squads.upsert({ projectId: env.proj.id, name: "a" });
    env.squads.upsert({ projectId: env.proj.id, name: "b" });
    expect(env.squads.list(env.proj.id)).toHaveLength(2);
  });

  test("list('') returns squads from all projects", () => {
    const proj2 = env.store.projectAdd({ path: "/tmp/s2" });
    env.squads.upsert({ projectId: env.proj.id, name: "p1" });
    env.squads.upsert({ projectId: proj2.id, name: "p2" });
    expect(env.squads.list("")).toHaveLength(2);
  });

  test("delete removes a squad", () => {
    const s = env.squads.upsert({ projectId: env.proj.id, name: "x" });
    env.squads.delete(s.id);
    expect(env.squads.list(env.proj.id)).toHaveLength(0);
  });

  test("fromRow exposed for testing", () => {
    const row = {
      id: "squad_1",
      project_id: "p",
      name: "squad",
      leader_workspace_id: "ws-1",
      member_ids_json: '["ws-1","ws-2"]',
      created_at: 1,
    };
    const s = SquadStore.fromRow(row);
    expect(s.leaderWorkspaceId).toBe("ws-1");
    expect(s.memberWorkspaceIds).toEqual(["ws-1", "ws-2"]);
  });
});
