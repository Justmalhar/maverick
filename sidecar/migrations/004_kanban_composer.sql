ALTER TABLE kanban_tasks ADD COLUMN agent_backend TEXT NOT NULL DEFAULT '';
ALTER TABLE kanban_tasks ADD COLUMN branch        TEXT NOT NULL DEFAULT '';
ALTER TABLE kanban_tasks ADD COLUMN attachments   TEXT NOT NULL DEFAULT '[]';
UPDATE kanban_tasks SET status = 'todo' WHERE status = 'backlog';
