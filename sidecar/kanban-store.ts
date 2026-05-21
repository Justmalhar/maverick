import { defaultIds } from "./deps";
import type { IdProvider, KanbanTask } from "./types";
import type { SQLiteStore } from "./sqlite-store";

interface KanbanRow {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  column_order: number;
  workspace_id: string | null;
  labels_json: string;
  due_date: number | null;
  created_at: number;
}

export interface KanbanStoreOptions {
  ids?: IdProvider;
}

export class KanbanStore {
  private ids: IdProvider;

  constructor(private store: SQLiteStore, opts: KanbanStoreOptions = {}) {
    this.ids = opts.ids ?? defaultIds;
  }

  list(projectId: string): KanbanTask[] {
    const rows = this.store.db
      .query<KanbanRow, [string]>(
        "SELECT * FROM kanban_tasks WHERE project_id = ? ORDER BY status ASC, column_order ASC"
      )
      .all(projectId);
    return rows.map(KanbanStore.fromRow);
  }

  upsert(task: Partial<KanbanTask> & { projectId: string; title: string }): KanbanTask {
    const id = task.id ?? this.ids.uuid("task");
    const status = task.status ?? "backlog";
    const columnOrder = task.columnOrder ?? 0;
    const labels = JSON.stringify(task.labels ?? []);
    const createdAt = task.createdAt ?? Math.floor(this.ids.now() / 1000);
    this.store.db
      .query(
        `INSERT INTO kanban_tasks (id, project_id, title, description, status, column_order, workspace_id, labels_json, due_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           project_id = excluded.project_id,
           title = excluded.title,
           description = excluded.description,
           status = excluded.status,
           column_order = excluded.column_order,
           workspace_id = excluded.workspace_id,
           labels_json = excluded.labels_json,
           due_date = excluded.due_date`
      )
      .run(
        id,
        task.projectId,
        task.title,
        task.description ?? null,
        status,
        columnOrder,
        task.workspaceId ?? null,
        labels,
        task.dueDate ?? null,
        createdAt
      );
    return {
      id,
      projectId: task.projectId,
      title: task.title,
      description: task.description,
      status,
      columnOrder,
      workspaceId: task.workspaceId,
      labels: task.labels ?? [],
      dueDate: task.dueDate,
      createdAt,
    };
  }

  delete(id: string): { ok: true } {
    this.store.db.query("DELETE FROM kanban_tasks WHERE id = ?").run(id);
    return { ok: true };
  }

  static fromRow(row: KanbanRow): KanbanTask {
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description ?? undefined,
      status: row.status as KanbanTask["status"],
      columnOrder: row.column_order,
      workspaceId: row.workspace_id ?? undefined,
      labels: JSON.parse(row.labels_json) as string[],
      dueDate: row.due_date ?? undefined,
      createdAt: row.created_at,
    };
  }
}
