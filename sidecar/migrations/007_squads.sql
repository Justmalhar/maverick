CREATE TABLE IF NOT EXISTS squads (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES projects(id),
  name                  TEXT NOT NULL,
  leader_workspace_id   TEXT REFERENCES workspaces(id),
  member_ids_json       TEXT NOT NULL DEFAULT '[]',
  created_at            INTEGER NOT NULL DEFAULT (unixepoch())
);
