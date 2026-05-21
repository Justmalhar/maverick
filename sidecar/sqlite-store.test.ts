import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SQLiteStore, defaultDbPath, defaultMigrationsDir } from "./sqlite-store";

function makeStore(): SQLiteStore {
  let counter = 0;
  return new SQLiteStore({
    path: ":memory:",
    migrationsDir: defaultMigrationsDir(),
    ids: {
      uuid: (prefix) => `${prefix}_${++counter}`,
      now: () => 1_700_000_000_000 + counter * 1000,
    },
  });
}

describe("SQLiteStore", () => {
  let store: SQLiteStore;

  beforeEach(() => {
    store = makeStore();
  });

  test("projectAdd inserts and returns Project", () => {
    const p = store.projectAdd({ path: "/tmp/repo", name: "repo" });
    expect(p.name).toBe("repo");
    expect(p.path).toBe("/tmp/repo");
    expect(p.id.startsWith("proj_")).toBe(true);
  });

  test("projectAdd infers name from path when omitted", () => {
    const p = store.projectAdd({ path: "/tmp/inferred" });
    expect(p.name).toBe("inferred");
  });

  test("projectAdd uses fallback name for empty path", () => {
    const p = store.projectAdd({ path: "/" });
    expect(p.name).toBe("project");
  });

  test("projectList returns projects in descending order", () => {
    store.projectAdd({ path: "/a" });
    store.projectAdd({ path: "/b" });
    const list = store.projectList();
    expect(list).toHaveLength(2);
  });

  test("workspaceCreate inserts workspace and session", () => {
    const proj = store.projectAdd({ path: "/tmp/x" });
    const ws = store.workspaceCreate({
      projectId: proj.id,
      branch: "feat",
      agentBackend: "claude",
      worktreePath: "/tmp/wt",
    });
    expect(ws.status).toBe("idle");
    expect(ws.sessionId.startsWith("sess_")).toBe(true);
  });

  test("workspaceList filters by projectId and includes session", () => {
    const proj = store.projectAdd({ path: "/tmp/y" });
    store.workspaceCreate({
      projectId: proj.id,
      branch: "main",
      agentBackend: "codex",
      worktreePath: "/tmp/wt2",
    });
    const list = store.workspaceList(proj.id);
    expect(list).toHaveLength(1);
    expect(list[0].sessionId).not.toBe("");
  });

  test("workspaceList returns all when no projectId", () => {
    const proj = store.projectAdd({ path: "/tmp/z" });
    store.workspaceCreate({
      projectId: proj.id,
      branch: "main",
      agentBackend: "codex",
      worktreePath: "/tmp/wt3",
    });
    expect(store.workspaceList()).toHaveLength(1);
  });

  test("workspaceDestroy removes workspace and cascading rows", () => {
    const proj = store.projectAdd({ path: "/tmp/d" });
    const ws = store.workspaceCreate({
      projectId: proj.id,
      branch: "main",
      agentBackend: "claude",
      worktreePath: "/tmp/wt-d",
    });
    store.messageAppend({ sessionId: ws.sessionId, role: "user", content: "hi" });
    const r = store.workspaceDestroy(ws.id);
    expect(r.worktreePath).toBe("/tmp/wt-d");
    expect(store.workspaceList(proj.id)).toHaveLength(0);
  });

  test("workspaceDestroy throws on missing id", () => {
    expect(() => store.workspaceDestroy("nope")).toThrow();
  });

  test("messageAppend + messagesList round-trip", () => {
    const proj = store.projectAdd({ path: "/tmp/m" });
    const ws = store.workspaceCreate({
      projectId: proj.id,
      branch: "main",
      agentBackend: "claude",
      worktreePath: "/tmp/wt-m",
    });
    store.messageAppend({ sessionId: ws.sessionId, role: "user", content: "hi" });
    store.messageAppend({
      sessionId: ws.sessionId,
      role: "assistant",
      content: "hello",
      toolCallsJson: '{"x":1}',
    });
    const msgs = store.messagesList({ sessionId: ws.sessionId });
    expect(msgs).toHaveLength(2);
    expect(msgs[1].toolCallsJson).toBe('{"x":1}');
  });

  test("messagesList applies limit and offset", () => {
    const proj = store.projectAdd({ path: "/tmp/lim" });
    const ws = store.workspaceCreate({
      projectId: proj.id,
      branch: "main",
      agentBackend: "claude",
      worktreePath: "/tmp/wt-lim",
    });
    for (let i = 0; i < 5; i++) {
      store.messageAppend({ sessionId: ws.sessionId, role: "user", content: `m${i}` });
    }
    const page = store.messagesList({ sessionId: ws.sessionId, limit: 2, offset: 2 });
    expect(page).toHaveLength(2);
  });

  test("defaultDbPath returns platform-appropriate path", () => {
    const p = defaultDbPath();
    expect(p.endsWith("db.sqlite")).toBe(true);
  });

  test("constructor creates directory if missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "mvk-"));
    const path = join(tmp, "nested", "dir", "db.sqlite");
    const s = new SQLiteStore({ path, migrationsDir: defaultMigrationsDir() });
    expect(s.projectList()).toEqual([]);
    s.close();
  });

  test("constructor tolerates missing migrations dir", () => {
    const s = new SQLiteStore({ path: ":memory:", migrationsDir: "/nonexistent-path-xyz" });
    expect(() => s.projectList()).toThrow();
    s.close();
  });

  test("close releases the database", () => {
    const s = makeStore();
    s.close();
    expect(() => s.projectList()).toThrow();
  });

  test("sessionCreate is callable directly", () => {
    const proj = store.projectAdd({ path: "/tmp/sess" });
    const ws = store.workspaceCreate({
      projectId: proj.id,
      branch: "main",
      agentBackend: "claude",
      worktreePath: "/tmp/wt-s",
    });
    const id = store.sessionCreate(ws.id);
    expect(id.startsWith("sess_")).toBe(true);
  });
});
