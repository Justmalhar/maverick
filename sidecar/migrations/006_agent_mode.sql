ALTER TABLE workspaces ADD COLUMN mode TEXT NOT NULL DEFAULT 'terminal';
ALTER TABLE sessions ADD COLUMN provider_session_id TEXT;
ALTER TABLE sessions ADD COLUMN model TEXT;
ALTER TABLE sessions ADD COLUMN reasoning_level TEXT;
ALTER TABLE messages ADD COLUMN parts_json TEXT;
ALTER TABLE messages ADD COLUMN turn_id TEXT;
CREATE TABLE IF NOT EXISTS agent_checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  git_sha TEXT NOT NULL,
  provider_session_id TEXT,
  provider_line_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_session ON agent_checkpoints(session_id, created_at)
