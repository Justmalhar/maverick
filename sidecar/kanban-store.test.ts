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
    expect(t.status).toBe("backlog");
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
    };
    const k = KanbanStore.fromRow(row);
    expect(k.status).toBe("review");
    expect(k.description).toBeUndefined();
  });
});
