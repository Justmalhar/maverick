CREATE TABLE IF NOT EXISTS autopilots (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id),
  name              TEXT NOT NULL,
  backend           TEXT NOT NULL DEFAULT '',
  branch            TEXT NOT NULL DEFAULT '',
  prompt            TEXT NOT NULL DEFAULT '',
  interval_minutes  INTEGER,
  enabled           INTEGER NOT NULL DEFAULT 1,
  last_run_at       INTEGER,
  last_status       TEXT NOT NULL DEFAULT 'never',
  last_error        TEXT,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
