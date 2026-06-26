import { defaultIds } from "./deps";
import type { IdProvider, KanbanTask, Attachment } from "./types";
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
  agent_backend: string;
  branch: string;
  attachments: string;
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
    if (projectId === "") {
      const rows = this.store.db
        .query<KanbanRow, []>(
          "SELECT * FROM kanban_tasks ORDER BY status ASC, column_order ASC"
        )
        .all();
      return rows.map(KanbanStore.fromRow);
    }
    const rows = this.store.db
      .query<KanbanRow, [string]>(
        "SELECT * FROM kanban_tasks WHERE project_id = ? ORDER BY status ASC, column_order ASC"
      )
      .all(projectId);
    return rows.map(KanbanStore.fromRow);
  }

  upsert(task: Partial<KanbanTask> & { projectId: string; title: string }): KanbanTask {
    const id = task.id ?? this.ids.uuid("task");
    const status = task.status ?? "todo";
    const columnOrder = task.columnOrder ?? 0;
    const labels = JSON.stringify(task.labels ?? []);
    const attachments = JSON.stringify(task.attachments ?? []);
    const createdAt = task.createdAt ?? Math.floor(this.ids.now() / 1000);
    const agentBackend = task.agentBackend ?? "";
    const branch = task.branch ?? "";

    type Bind = [
      string, string, string, string | null, string, number,
      string | null, string, number | null, number, string, string, string,
    ];
    const row = this.store.db
      .query<KanbanRow, Bind>(
        `INSERT INTO kanban_tasks
           (id, project_id, title, description, status, column_order, workspace_id,
            labels_json, due_date, created_at, agent_backend, branch, attachments)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           project_id    = excluded.project_id,
           title         = excluded.title,
           -- A partial upsert (a status-only move, a dialog edit that doesn't
           -- carry workspace_id) must NOT null these out; keep the stored value
           -- when the incoming one is NULL. Clearing uses an explicit value.
           description   = COALESCE(excluded.description, kanban_tasks.description),
           status        = excluded.status,
           column_order  = excluded.column_order,
           workspace_id  = COALESCE(excluded.workspace_id, kanban_tasks.workspace_id),
           labels_json   = excluded.labels_json,
           due_date      = excluded.due_date,
           agent_backend = excluded.agent_backend,
           branch        = excluded.branch,
           attachments   = excluded.attachments
         RETURNING *`
      )
      .get(
        id,
        task.projectId,
        task.title,
        task.description ?? null,
        status,
        columnOrder,
        task.workspaceId ?? null,
        labels,
        task.dueDate ?? null,
        createdAt,
        agentBackend,
        branch,
        attachments
      );

    // RETURNING gives the row the DB actually persisted (post-COALESCE), so the
    // caller never sees a fabricated value — e.g. created_at on an update, or a
    // description/workspace_id the merge preserved.
    return KanbanStore.fromRow(row!);
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
      agentBackend: row.agent_backend,
      branch: row.branch,
      attachments: JSON.parse(row.attachments) as Attachment[],
    };
  }
}
