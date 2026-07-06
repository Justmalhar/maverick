import { defaultIds } from "./deps";
import type { IdProvider, Squad } from "./types";
import type { SQLiteStore } from "./sqlite-store";

interface SquadRow {
  id: string;
  project_id: string;
  name: string;
  leader_workspace_id: string | null;
  member_ids_json: string;
  created_at: number;
}

export interface SquadStoreOptions {
  ids?: IdProvider;
}

export class SquadStore {
  private ids: IdProvider;

  constructor(private store: SQLiteStore, opts: SquadStoreOptions = {}) {
    this.ids = opts.ids ?? defaultIds;
  }

  list(projectId: string): Squad[] {
    if (projectId === "") {
      const rows = this.store.db
        .query<SquadRow, []>("SELECT * FROM squads ORDER BY created_at ASC")
        .all();
      return rows.map(SquadStore.fromRow);
    }
    const rows = this.store.db
      .query<SquadRow, [string]>(
        "SELECT * FROM squads WHERE project_id = ? ORDER BY created_at ASC"
      )
      .all(projectId);
    return rows.map(SquadStore.fromRow);
  }

  upsert(s: Partial<Squad> & { projectId: string; name: string }): Squad {
    const id = s.id ?? this.ids.uuid("squad");
    const memberIds = JSON.stringify(s.memberWorkspaceIds ?? []);
    const createdAt = s.createdAt ?? Math.floor(this.ids.now() / 1000);

    type Bind = [string, string, string, string | null, string, number];
    const row = this.store.db
      .query<SquadRow, Bind>(
        `INSERT INTO squads
           (id, project_id, name, leader_workspace_id, member_ids_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           project_id          = excluded.project_id,
           name                = excluded.name,
           leader_workspace_id = excluded.leader_workspace_id,
           member_ids_json     = excluded.member_ids_json
         RETURNING *`
      )
      .get(id, s.projectId, s.name, s.leaderWorkspaceId ?? null, memberIds, createdAt);

    return SquadStore.fromRow(row!);
  }

  delete(id: string): { ok: true } {
    this.store.db.query("DELETE FROM squads WHERE id = ?").run(id);
    return { ok: true };
  }

  static fromRow(row: SquadRow): Squad {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      leaderWorkspaceId: row.leader_workspace_id ?? undefined,
      memberWorkspaceIds: JSON.parse(row.member_ids_json) as string[],
      createdAt: row.created_at,
    };
  }
}
