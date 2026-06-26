import { describe, test, expect, beforeEach } from "bun:test";
import { SQLiteStore, defaultMigrationsDir } from "./sqlite-store";
import { KanbanStore } from "./kanban-store";

function makeStore() {
  let n = 0;
  const ids = {
    uuid: (p: string) => `${p}_${++n}`,
    now: () => 1_700_000_000_000 + n * 1000,
  };
  const store = new SQLiteStore({ path: ":memory:", migrationsDir: defaultMigrationsDir(), ids });
  const kanban = new KanbanStore(store, { ids });
  const proj = store.projectAdd({ path: "/tmp/k" });
  return { store, kanban, proj };
}

describe("KanbanStore", () => {
  let env = makeStore();

  beforeEach(() => {
    env = makeStore();
  });

  test("upsert inserts a new task", () => {
    const t = env.kanban.upsert({ projectId: env.proj.id, title: "Build feature" });
    expect(t.id.startsWith("task_")).toBe(true);
    expect(t.status).toBe("todo");
  });

  test("upsert respects provided id and updates existing", () => {
    const t1 = env.kanban.upsert({ projectId: env.proj.id, title: "first" });
    const t2 = env.kanban.upsert({ id: t1.id, projectId: env.proj.id, title: "renamed", status: "done" });
    expect(t2.id).toBe(t1.id);
    expect(t2.status).toBe("done");
    expect(env.kanban.list(env.proj.id)).toHaveLength(1);
  });

  test("list returns all tasks for project", () => {
    env.kanban.upsert({ projectId: env.proj.id, title: "a" });
    env.kanban.upsert({ projectId: env.proj.id, title: "b" });
    expect(env.kanban.list(env.proj.id)).toHaveLength(2);
  });

  test("upsert serializes labels and dueDate", () => {
    const t = env.kanban.upsert({
      projectId: env.proj.id,
      title: "labeled",
      labels: ["bug", "p1"],
      dueDate: 9999,
      description: "desc",
      workspaceId: undefined,
    });
    const fetched = env.kanban.list(env.proj.id)[0];
    expect(fetched.labels).toEqual(["bug", "p1"]);
    expect(fetched.dueDate).toBe(9999);
    expect(fetched.description).toBe("desc");
    expect(t.labels).toEqual(["bug", "p1"]);
  });

  test("partial upsert keeps an existing description and workspaceId (no NULL wipe)", () => {
    const ws = env.store.workspaceCreate({
      projectId: env.proj.id,
      branch: "feat",
      agentBackend: "claude",
      worktreePath: "/tmp/k/wt",
    });
    const t = env.kanban.upsert({
      projectId: env.proj.id,
      title: "task",
      description: "the original prompt",
      workspaceId: ws.id,
    });
    // A status-only move that omits description/workspaceId must not clear them.
    env.kanban.upsert({ id: t.id, projectId: env.proj.id, title: "task", status: "in_progress" });
    const fetched = env.kanban.list(env.proj.id)[0];
    expect(fetched.description).toBe("the original prompt");
    expect(fetched.workspaceId).toBe(ws.id);
    expect(fetched.status).toBe("in_progress");
  });

  test("upsert can still clear a description with an explicit empty string", () => {
    const t = env.kanban.upsert({ projectId: env.proj.id, title: "task", description: "has text" });
    env.kanban.upsert({ id: t.id, projectId: env.proj.id, title: "task", description: "" });
    // "" is not NULL, so COALESCE writes it through — the description is cleared.
    expect(env.kanban.list(env.proj.id)[0].description).toBe("");
  });

  test("upsert returns the persisted createdAt on update, not a fresh one", () => {
    const t1 = env.kanban.upsert({ projectId: env.proj.id, title: "task" });
    const t2 = env.kanban.upsert({ id: t1.id, projectId: env.proj.id, title: "task", status: "done" });
    expect(t2.createdAt).toBe(t1.createdAt);
  });

  test("delete removes a task", () => {
    const t = env.kanban.upsert({ projectId: env.proj.id, title: "x" });
    env.kanban.delete(t.id);
    expect(env.kanban.list(env.proj.id)).toHaveLength(0);
  });

  test("fromRow exposed for testing", () => {
    const row = {
      id: "task_1",
      project_id: "p",
      title: "t",
      description: null,
      status: "review",
      column_order: 0,
      workspace_id: null,
      labels_json: "[]",
      due_date: null,
      created_at: 1,
      agent_backend: "",
      branch: "",
      attachments: "[]",
    };
    const k = KanbanStore.fromRow(row);
    expect(k.status).toBe("review");
    expect(k.description).toBeUndefined();
  });

  test("upsert stores and retrieves agentBackend, branch, attachments", () => {
    const t = env.kanban.upsert({
      projectId: env.proj.id,
      title: "feat",
      agentBackend: "claude",
      branch: "main",
      attachments: [{ name: "f.txt", content: "hello", encoding: "utf8", size: 5 }],
    });
    expect(t.agentBackend).toBe("claude");
    expect(t.branch).toBe("main");
    expect(t.attachments).toEqual([{ name: "f.txt", content: "hello", encoding: "utf8", size: 5 }]);
  });

  test("default status is 'todo' not 'backlog'", () => {
    const t = env.kanban.upsert({ projectId: env.proj.id, title: "x" });
    expect(t.status).toBe("todo");
  });

  test("list('') returns tasks from all projects", () => {
    const proj2 = env.store.projectAdd({ path: "/tmp/other" });
    env.kanban.upsert({ projectId: env.proj.id, title: "p1-task" });
    env.kanban.upsert({ projectId: proj2.id, title: "p2-task" });
    const all = env.kanban.list("");
    expect(all.length).toBe(2);
  });

  test("list(projectId) filters correctly", () => {
    const proj2 = env.store.projectAdd({ path: "/tmp/p2" });
    env.kanban.upsert({ projectId: env.proj.id, title: "mine" });
    env.kanban.upsert({ projectId: proj2.id, title: "theirs" });
    const mine = env.kanban.list(env.proj.id);
    expect(mine.every((t) => t.projectId === env.proj.id)).toBe(true);
    expect(mine.length).toBe(1);
  });
});
