CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  path        TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS workspaces (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  branch          TEXT NOT NULL,
  agent_backend   TEXT NOT NULL,
  worktree_path   TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'idle',
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
  started_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  ended_at      INTEGER
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES sessions(id),
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  tool_calls_json TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS backends (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  command     TEXT NOT NULL,
  args_json   TEXT NOT NULL DEFAULT '[]',
  env_json    TEXT NOT NULL DEFAULT '{}',
  active      INTEGER NOT NULL DEFAULT 1
);
