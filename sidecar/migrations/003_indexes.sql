CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_workspaces_project ON workspaces(project_id);
CREATE INDEX IF NOT EXISTS idx_kanban_project ON kanban_tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_notifications_workspace ON notifications(workspace_id, read);
CREATE INDEX IF NOT EXISTS idx_presets_project ON workspace_presets(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_context_session ON context_usage(session_id);
