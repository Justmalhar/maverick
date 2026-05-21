CREATE TABLE IF NOT EXISTS workspace_presets (
  id            TEXT PRIMARY KEY,
  project_id    TEXT REFERENCES projects(id),
  name          TEXT NOT NULL,
  description   TEXT,
  base_branch   TEXT,
  layout_json   TEXT NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS kanban_tasks (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  title         TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'backlog',
  column_order  REAL NOT NULL DEFAULT 0,
  workspace_id  TEXT REFERENCES workspaces(id),
  labels_json   TEXT NOT NULL DEFAULT '[]',
  due_date      INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS notifications (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT REFERENCES workspaces(id),
  type          TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  read          INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS context_usage (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES sessions(id),
  tokens_used     INTEGER NOT NULL DEFAULT 0,
  context_window  INTEGER NOT NULL DEFAULT 200000,
  cost_estimate   REAL NOT NULL DEFAULT 0.0,
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS repo_configs (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) UNIQUE,
  workspaces_path   TEXT,
  base_branch       TEXT NOT NULL DEFAULT 'origin/main',
  remote_origin     TEXT NOT NULL DEFAULT 'origin',
  preview_url       TEXT,
  files_to_copy     TEXT NOT NULL DEFAULT '[]',
  setup_script      TEXT,
  run_script        TEXT,
  archive_script    TEXT,
  instructions      TEXT,
  review_prefs      TEXT,
  pr_prefs          TEXT,
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
