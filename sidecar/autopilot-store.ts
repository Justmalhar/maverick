import { defaultIds } from "./deps";
import type { IdProvider, Autopilot } from "./types";
import type { SQLiteStore } from "./sqlite-store";

interface AutopilotRow {
  id: string;
  project_id: string;
  name: string;
  backend: string;
  branch: string;
  prompt: string;
  interval_minutes: number | null;
  enabled: number;
  last_run_at: number | null;
  last_status: string;
  last_error: string | null;
  created_at: number;
}

export interface AutopilotStoreOptions {
  ids?: IdProvider;
}

export class AutopilotStore {
  private ids: IdProvider;

  constructor(private store: SQLiteStore, opts: AutopilotStoreOptions = {}) {
    this.ids = opts.ids ?? defaultIds;
  }

  list(projectId: string): Autopilot[] {
    if (projectId === "") {
      const rows = this.store.db
        .query<AutopilotRow, []>("SELECT * FROM autopilots ORDER BY created_at ASC")
        .all();
      return rows.map(AutopilotStore.fromRow);
    }
    const rows = this.store.db
      .query<AutopilotRow, [string]>(
        "SELECT * FROM autopilots WHERE project_id = ? ORDER BY created_at ASC"
      )
      .all(projectId);
    return rows.map(AutopilotStore.fromRow);
  }

  get(id: string): Autopilot | null {
    const row = this.store.db
      .query<AutopilotRow, [string]>("SELECT * FROM autopilots WHERE id = ?")
      .get(id);
    return row ? AutopilotStore.fromRow(row) : null;
  }

  upsert(a: Partial<Autopilot> & { projectId: string; name: string }): Autopilot {
    const id = a.id ?? this.ids.uuid("autopilot");
    const backend = a.backend ?? "";
    const branch = a.branch ?? "";
    const prompt = a.prompt ?? "";
    const intervalMinutes = a.intervalMinutes ?? null;
    const enabled = a.enabled ?? true;
    const createdAt = a.createdAt ?? Math.floor(this.ids.now() / 1000);

    type Bind = [
      string, string, string, string, string, string,
      number | null, number, number,
    ];
    const row = this.store.db
      .query<AutopilotRow, Bind>(
        `INSERT INTO autopilots
           (id, project_id, name, backend, branch, prompt, interval_minutes, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           project_id       = excluded.project_id,
           name             = excluded.name,
           backend          = excluded.backend,
           branch           = excluded.branch,
           prompt           = excluded.prompt,
           interval_minutes = excluded.interval_minutes,
           enabled          = excluded.enabled
         RETURNING *`
      )
      .get(id, a.projectId, a.name, backend, branch, prompt, intervalMinutes, enabled ? 1 : 0, createdAt);

    return AutopilotStore.fromRow(row!);
  }

  delete(id: string): { ok: true } {
    this.store.db.query("DELETE FROM autopilots WHERE id = ?").run(id);
    return { ok: true };
  }

  /** Enabled, interval-scheduled autopilots whose interval has elapsed since the last run. */
  dueForCheck(nowSec: number): Autopilot[] {
    const rows = this.store.db
      .query<AutopilotRow, [number]>(
        `SELECT * FROM autopilots
         WHERE enabled = 1
           AND interval_minutes IS NOT NULL
           AND (last_run_at IS NULL OR ? - last_run_at >= interval_minutes * 60)`
      )
      .all(nowSec);
    return rows.map(AutopilotStore.fromRow);
  }

  markRun(id: string, result: { status: "ok" | "error"; error?: string }): void {
    this.store.db
      .query("UPDATE autopilots SET last_run_at = ?, last_status = ?, last_error = ? WHERE id = ?")
      .run(Math.floor(this.ids.now() / 1000), result.status, result.error ?? null, id);
  }

  static fromRow(row: AutopilotRow): Autopilot {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      backend: row.backend,
      branch: row.branch,
      prompt: row.prompt,
      intervalMinutes: row.interval_minutes,
      enabled: row.enabled !== 0,
      lastRunAt: row.last_run_at,
      lastStatus: row.last_status as Autopilot["lastStatus"],
      lastError: row.last_error ?? undefined,
      createdAt: row.created_at,
    };
  }
}
