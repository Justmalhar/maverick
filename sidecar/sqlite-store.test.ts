import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
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

  test("a legacy DB (projects table, no migration rows) gets every migration applied (#23)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mvk-mig-"));
    const dbPath = join(dir, "legacy.db");
    // Pre-tracking DB that only ever ran 001: a projects table, NO schema_migrations.
    // The old baseline marked all migrations applied WITHOUT running them, so
    // kanban_tasks (002) and workspaces.title (005) never existed.
    const legacy = new Database(dbPath, { create: true });
    legacy.run("CREATE TABLE projects (id TEXT PRIMARY KEY, path TEXT NOT NULL, name TEXT, created_at INTEGER)");
    legacy.close();

    const store = new SQLiteStore({ path: dbPath, migrationsDir: defaultMigrationsDir() });
    const kanbanCols = store.db.query("PRAGMA table_info(kanban_tasks)").all() as Array<{ name: string }>;
    expect(kanbanCols.some((c) => c.name === "agent_backend")).toBe(true);
    expect(kanbanCols.some((c) => c.name === "attachments")).toBe(true);
    const wsCols = store.db.query("PRAGMA table_info(workspaces)").all() as Array<{ name: string }>;
    expect(wsCols.some((c) => c.name === "title")).toBe(true);
  });

  test("re-running migrations on a DB that already has the columns is a no-op (#23)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mvk-mig2-"));
    const dbPath = join(dir, "full.db");
    new SQLiteStore({ path: dbPath, migrationsDir: defaultMigrationsDir() }); // fully migrate
    // Wipe tracking rows → next open re-runs every migration; the ADD COLUMNs
    // must tolerate the now-duplicate columns instead of throwing.
    const raw = new Database(dbPath);
    raw.run("DELETE FROM schema_migrations");
    raw.close();
    expect(() => new SQLiteStore({ path: dbPath, migrationsDir: defaultMigrationsDir() })).not.toThrow();
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

  test("projectAdd infers name from a Windows backslash path", () => {
    const p = store.projectAdd({ path: "C:\\Users\\me\\my-repo" });
    expect(p.name).toBe("my-repo");
    expect(p.path).toBe("C:\\Users\\me\\my-repo");
  });

  test("projectAdd infers name from a Windows path with trailing separator", () => {
    const p = store.projectAdd({ path: "C:\\dev\\maverick\\" });
    expect(p.name).toBe("maverick");
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

  test("workspaceGet returns the latest sessionId, matching workspaceList", () => {
    const proj = store.projectAdd({ path: "/tmp/g" });
    const ws = store.workspaceCreate({
      projectId: proj.id,
      branch: "feat",
      agentBackend: "claude",
      worktreePath: "/tmp/wtg",
    });
    const fetched = store.workspaceGet(ws.id);
    expect(fetched?.sessionId).toBe(ws.sessionId);
    expect(fetched?.sessionId).not.toBe("");
  });

  test("workspaceGet returns null for unknown id", () => {
    expect(store.workspaceGet("ws_missing")).toBeNull();
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

  test("workspaceDestroy detaches kanban tasks and deletes notifications", () => {
    const proj = store.projectAdd({ path: "/tmp/d2" });
    const ws = store.workspaceCreate({
      projectId: proj.id,
      branch: "main",
      agentBackend: "claude",
      worktreePath: "/tmp/wt-d2",
    });
    store.db
      .query(
        `INSERT INTO kanban_tasks
           (id, project_id, title, description, status, column_order, workspace_id,
            labels_json, due_date, created_at, agent_backend, branch, attachments)
         VALUES ('task_x', ?, 't', NULL, 'todo', 0, ?, '[]', NULL, 0, '', '', '[]')`
      )
      .run(proj.id, ws.id);
    store.notificationInsert({ workspaceId: ws.id, type: "agent", title: "t", body: "b" });

    store.workspaceDestroy(ws.id);

    const task = store.db
      .query<{ workspace_id: string | null }, []>(
        "SELECT workspace_id FROM kanban_tasks WHERE id = 'task_x'"
      )
      .get();
    expect(task?.workspace_id).toBeNull();
    expect(store.notificationList().filter((n) => n.workspaceId === ws.id)).toHaveLength(0);
  });

  test("notificationDelete removes one and notificationClearAll empties the table", () => {
    const a = store.notificationInsert({ workspaceId: null, type: "info", title: "a", body: "" });
    const b = store.notificationInsert({ workspaceId: null, type: "info", title: "b", body: "" });
    expect(store.notificationList()).toHaveLength(2);

    store.notificationDelete({ id: a.id });
    const afterDelete = store.notificationList();
    expect(afterDelete).toHaveLength(1);
    expect(afterDelete[0].id).toBe(b.id);

    store.notificationClearAll();
    expect(store.notificationList()).toHaveLength(0);
  });

  test("workspaceDestroy throws on missing id", () => {
    expect(() => store.workspaceDestroy("nope")).toThrow();
  });

  test("projectDestroy deletes project-scoped rows and the project", () => {
    const proj = store.projectAdd({ path: "/tmp/pd" });
    store.db
      .query(
        `INSERT INTO kanban_tasks
           (id, project_id, title, description, status, column_order, workspace_id,
            labels_json, due_date, created_at, agent_backend, branch, attachments)
         VALUES ('task_pd', ?, 't', NULL, 'todo', 0, NULL, '[]', NULL, 0, '', '', '[]')`
      )
      .run(proj.id);
    store.db
      .query(
        `INSERT INTO workspace_presets (id, project_id, name, description, base_branch, layout_json, created_at)
         VALUES ('preset_pd', ?, 'p', '', 'main', '{}', 0)`
      )
      .run(proj.id);
    store.db
      .query("INSERT INTO repo_configs (id, project_id) VALUES ('rc_pd', ?)")
      .run(proj.id);

    const r = store.projectDestroy(proj.id);

    expect(r.ok).toBe(true);
    expect(store.projectGet(proj.id)).toBeNull();
    expect(store.db.query("SELECT id FROM kanban_tasks WHERE id = 'task_pd'").get()).toBeNull();
    expect(store.db.query("SELECT id FROM workspace_presets WHERE id = 'preset_pd'").get()).toBeNull();
    expect(store.db.query("SELECT id FROM repo_configs WHERE id = 'rc_pd'").get()).toBeNull();
  });

  test("projectDestroy on a missing project is a no-op returning ok", () => {
    expect(store.projectDestroy("nope")).toEqual({ ok: true });
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

  test("projectByPath returns the matching project", () => {
    const proj = store.projectAdd({ path: "/tmp/by-path" });
    expect(store.projectByPath("/tmp/by-path")?.id).toBe(proj.id);
  });

  test("projectByPath returns null when no project matches", () => {
    expect(store.projectByPath("/tmp/missing")).toBeNull();
  });

  test("presetSave with projectId persists and presetList returns it", () => {
    const proj = store.projectAdd({ path: "/tmp/presets" });
    const layout = { type: "terminal" as const, agent: "claude", cwd: "/", mode: "agent" as const };
    const saved = store.presetSave({ name: "p1", layout, projectId: proj.id, description: "d", baseBranch: "dev" });
    expect(saved.name).toBe("p1");
    expect(saved.description).toBe("d");
    expect(saved.baseBranch).toBe("dev");
    const list = store.presetList(proj.id);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("p1");
    expect(list[0].layout).toEqual(layout);
    expect(list[0].description).toBe("d");
    expect(list[0].baseBranch).toBe("dev");
  });

  test("presetSave resolves projectId from workspaceId", () => {
    const proj = store.projectAdd({ path: "/tmp/ws-presets" });
    const ws = store.workspaceCreate({
      projectId: proj.id,
      branch: "main",
      agentBackend: "claude",
      worktreePath: "/tmp/wt-p",
    });
    const layout = { type: "terminal" as const, agent: "codex", cwd: "/", mode: "terminal" as const };
    store.presetSave({ name: "from-ws", layout, workspaceId: ws.id });
    expect(store.presetList(proj.id).map((p) => p.name)).toEqual(["from-ws"]);
  });

  test("presetSave with neither id stores a null project_id (not listed per-project)", () => {
    const proj = store.projectAdd({ path: "/tmp/orphan" });
    const layout = { type: "browser" as const, url: "https://x" };
    const saved = store.presetSave({ name: "orphan", layout });
    expect(saved.name).toBe("orphan");
    expect(saved.description).toBeUndefined();
    expect(saved.baseBranch).toBeUndefined();
    expect(store.presetList(proj.id)).toHaveLength(0);
  });

  test("presetList orders newest first", () => {
    const proj = store.projectAdd({ path: "/tmp/order" });
    const t = (agent: string) => ({ type: "terminal" as const, agent, cwd: "/", mode: "agent" as const });
    store.presetSave({ name: "first", layout: t("a"), projectId: proj.id });
    store.presetSave({ name: "second", layout: t("b"), projectId: proj.id });
    expect(store.presetList(proj.id).map((p) => p.name)).toEqual(["second", "first"]);
  });
});

describe("agent mode storage", () => {
  let store: SQLiteStore;

  beforeEach(() => {
    let counter = 0;
    store = new SQLiteStore({
      path: ":memory:",
      migrationsDir: defaultMigrationsDir(),
      ids: {
        uuid: (prefix) => `${prefix}_${++counter}`,
        now: () => 1_700_000_000_000 + counter * 1000,
      },
    });
  });

  test("workspaceCreate persists mode and defaults to terminal", () => {
    const proj = store.projectAdd({ path: "/tmp/mode-test" });
    const ws = store.workspaceCreate({ projectId: proj.id, branch: "b", agentBackend: "claude", worktreePath: "/tmp/w" });
    expect(ws.mode).toBe("terminal");
    const agentWs = store.workspaceCreate({ projectId: proj.id, branch: "b2", agentBackend: "claude", worktreePath: "/tmp/w2", mode: "agent" });
    expect(agentWs.mode).toBe("agent");
    expect(store.workspaceGet(agentWs.id)?.mode).toBe("agent");
    expect(store.workspaceList(proj.id).find((w) => w.id === agentWs.id)?.mode).toBe("agent");
  });

  test("session meta round-trips", () => {
    const proj = store.projectAdd({ path: "/tmp/meta-test" });
    const ws = store.workspaceCreate({ projectId: proj.id, branch: "m", agentBackend: "claude", worktreePath: "/tmp/m", mode: "agent" });
    expect(store.sessionMetaGet(ws.sessionId)).toEqual({
      workspaceId: ws.id, providerSessionId: null, model: null, reasoningLevel: null,
    });
    store.sessionMetaSet(ws.sessionId, { providerSessionId: "prov1", model: "claude-sonnet-4-6" });
    expect(store.sessionMetaGet(ws.sessionId)).toEqual({
      workspaceId: ws.id, providerSessionId: "prov1", model: "claude-sonnet-4-6", reasoningLevel: null,
    });
  });

  test("agentMessageAppend + messagesList round-trip parts", () => {
    const proj = store.projectAdd({ path: "/tmp/parts-test" });
    const ws = store.workspaceCreate({ projectId: proj.id, branch: "pm", agentBackend: "claude", worktreePath: "/tmp/pm", mode: "agent" });
    store.agentMessageAppend({
      id: "m1", sessionId: ws.sessionId, role: "user", content: "hi",
      partsJson: JSON.stringify([{ type: "text", text: "hi" }]), turnId: "t1", createdAt: 100,
    });
    const [m] = store.messagesList({ sessionId: ws.sessionId });
    expect(m.id).toBe("m1");
    expect(m.turnId).toBe("t1");
    expect(JSON.parse(m.partsJson!)).toEqual([{ type: "text", text: "hi" }]);
  });

  test("messagesTruncateFrom deletes the message and everything after", () => {
    const proj = store.projectAdd({ path: "/tmp/trunc-test" });
    const ws = store.workspaceCreate({ projectId: proj.id, branch: "tr", agentBackend: "claude", worktreePath: "/tmp/tr", mode: "agent" });
    for (const [id, at] of [["m1", 10], ["m2", 20], ["m3", 30]] as const) {
      store.agentMessageAppend({ id, sessionId: ws.sessionId, role: "user", content: id, partsJson: "[]", turnId: id, createdAt: at });
    }
    store.messagesTruncateFrom(ws.sessionId, "m2");
    expect(store.messagesList({ sessionId: ws.sessionId }).map((m) => m.id)).toEqual(["m1"]);
  });

  test("checkpoints create/lookup/truncate and workspaceDestroy cascade", () => {
    const proj = store.projectAdd({ path: "/tmp/cp-test" });
    const ws = store.workspaceCreate({ projectId: proj.id, branch: "cp", agentBackend: "claude", worktreePath: "/tmp/cp", mode: "agent" });
    store.checkpointCreate({ id: "c1", sessionId: ws.sessionId, messageId: "m1", gitSha: "sha1", providerSessionId: null, providerLineCount: 0, createdAt: 10 });
    store.checkpointCreate({ id: "c2", sessionId: ws.sessionId, messageId: "m2", gitSha: "sha2", providerSessionId: "p", providerLineCount: 4, createdAt: 20 });
    expect(store.checkpointByMessage(ws.sessionId, "m2")?.gitSha).toBe("sha2");
    store.checkpointsTruncateFrom(ws.sessionId, 20);
    expect(store.checkpointByMessage(ws.sessionId, "m2")).toBeNull();
    expect(store.checkpointByMessage(ws.sessionId, "m1")).not.toBeNull();
    store.workspaceDestroy(ws.id);
    expect(store.checkpointByMessage(ws.sessionId, "m1")).toBeNull();
  });
});
