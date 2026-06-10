import { Database } from "bun:sqlite";
import { readdirSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { defaultIds } from "./deps";
import type {
  IdProvider,
  Project,
  Workspace,
  Message,
  Notification,
  WorkspacePreset,
  PresetNode,
} from "./types";

export function defaultDbPath(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "maverick", "db.sqlite");
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? homedir(), "maverick", "db.sqlite");
  }
  return join(homedir(), ".local", "share", "maverick", "db.sqlite");
}

export function defaultMigrationsDir(): string {
  return join(import.meta.dir, "migrations");
}

interface ProjectRow {
  id: string;
  name: string;
  path: string;
  created_at: number;
}

interface WorkspaceRow {
  id: string;
  project_id: string;
  branch: string;
  agent_backend: string;
  worktree_path: string;
  status: string;
  created_at: number;
  title: string | null;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  tool_calls_json: string | null;
  created_at: number;
}

interface SessionRow {
  id: string;
  workspace_id: string;
}

interface NotificationRow {
  id: string;
  workspace_id: string | null;
  type: string;
  title: string;
  body: string;
  read: number;
  created_at: number;
}

interface PresetRow {
  id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  base_branch: string | null;
  layout_json: string;
  created_at: number;
}

export interface SQLiteStoreOptions {
  path?: string;
  migrationsDir?: string;
  ids?: IdProvider;
}

export class SQLiteStore {
  readonly db: Database;
  private ids: IdProvider;

  constructor(opts: SQLiteStoreOptions = {}) {
    const path = opts.path ?? defaultDbPath();
    const migrationsDir = opts.migrationsDir ?? defaultMigrationsDir();
    this.ids = opts.ids ?? defaultIds;
    if (path !== ":memory:") {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(path, { create: true });
    this.db.run("PRAGMA journal_mode=WAL");
    this.db.run("PRAGMA foreign_keys=ON");
    this.runMigrations(migrationsDir);
  }

  private runMigrations(dir: string): void {
    if (!existsSync(dir)) return;
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)"
    );
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const appliedCount = (this.db
      .query("SELECT COUNT(*) AS n FROM schema_migrations")
      .get() as { n: number }).n;
    const projectsExists =
      this.db
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'")
        .get() !== null;
    if (appliedCount === 0 && projectsExists) {
      const now = Math.floor(Date.now() / 1000);
      const insert = this.db.query(
        "INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?, ?)"
      );
      for (const file of files) insert.run(file, now);
      return;
    }

    const isApplied = this.db.query(
      "SELECT 1 FROM schema_migrations WHERE name = ?"
    );
    const recordApplied = this.db.query(
      "INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?, ?)"
    );
    for (const file of files) {
      if (isApplied.get(file) !== null) continue;
      const sql = readFileSync(join(dir, file), "utf8");
      this.db.exec(sql);
      recordApplied.run(file, Math.floor(Date.now() / 1000));
    }
  }

  projectAdd(input: { path: string; name?: string }): Project {
    const id = this.ids.uuid("proj");
    const name = input.name ?? input.path.split("/").filter(Boolean).pop() ?? "project";
    const createdAt = Math.floor(this.ids.now() / 1000);
    this.db
      .query("INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)")
      .run(id, name, input.path, createdAt);
    return { id, name, path: input.path, createdAt };
  }

  projectList(): Project[] {
    const rows = this.db
      .query<ProjectRow, []>("SELECT id, name, path, created_at FROM projects ORDER BY created_at DESC")
      .all();
    return rows.map((r) => ({ id: r.id, name: r.name, path: r.path, createdAt: r.created_at }));
  }

  projectGet(id: string): Project | null {
    const row = this.db
      .query<ProjectRow, [string]>("SELECT id, name, path, created_at FROM projects WHERE id = ?")
      .get(id);
    return row ? { id: row.id, name: row.name, path: row.path, createdAt: row.created_at } : null;
  }

  projectByPath(path: string): Project | null {
    const row = this.db
      .query<ProjectRow, [string]>(
        "SELECT id, name, path, created_at FROM projects WHERE path = ? ORDER BY created_at DESC LIMIT 1"
      )
      .get(path);
    return row ? { id: row.id, name: row.name, path: row.path, createdAt: row.created_at } : null;
  }

  workspaceGet(id: string): Workspace | null {
    const row = this.db
      .query<WorkspaceRow, [string]>("SELECT * FROM workspaces WHERE id = ?")
      .get(id);
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.project_id,
      branch: row.branch,
      agentBackend: row.agent_backend,
      worktreePath: row.worktree_path,
      status: row.status as Workspace["status"],
      sessionId: "",
      title: row.title ?? undefined,
    };
  }

  workspaceCreate(input: {
    id?: string;
    projectId: string;
    branch: string;
    agentBackend: string;
    worktreePath: string;
    title?: string;
  }): Workspace {
    const id = input.id ?? this.ids.uuid("ws");
    const createdAt = Math.floor(this.ids.now() / 1000);
    this.db
      .query(
        "INSERT INTO workspaces (id, project_id, branch, agent_backend, worktree_path, status, created_at, title) VALUES (?, ?, ?, ?, ?, 'idle', ?, ?)"
      )
      .run(id, input.projectId, input.branch, input.agentBackend, input.worktreePath, createdAt, input.title ?? null);
    const sessionId = this.sessionCreate(id);
    return {
      id,
      projectId: input.projectId,
      branch: input.branch,
      agentBackend: input.agentBackend,
      worktreePath: input.worktreePath,
      status: "idle",
      sessionId,
      title: input.title,
    };
  }

  workspaceSetStatus(id: string, status: Workspace["status"]): { ok: true } {
    this.db.query("UPDATE workspaces SET status = ? WHERE id = ?").run(status, id);
    return { ok: true };
  }

  workspaceList(projectId?: string): Workspace[] {
    const rows = projectId
      ? this.db
          .query<WorkspaceRow, [string]>(
            "SELECT * FROM workspaces WHERE project_id = ? ORDER BY created_at DESC"
          )
          .all(projectId)
      : this.db.query<WorkspaceRow, []>("SELECT * FROM workspaces ORDER BY created_at DESC").all();
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      branch: r.branch,
      agentBackend: r.agent_backend,
      worktreePath: r.worktree_path,
      status: r.status as Workspace["status"],
      sessionId: this.latestSession(r.id) ?? "",
      title: r.title ?? undefined,
    }));
  }

  workspaceDestroy(workspaceId: string): { ok: true; worktreePath: string } {
    const row = this.db
      .query<{ worktree_path: string }, [string]>(
        "SELECT worktree_path FROM workspaces WHERE id = ?"
      )
      .get(workspaceId);
    if (!row) throw new Error(`workspace not found: ${workspaceId}`);
    this.db.query("DELETE FROM context_usage WHERE session_id IN (SELECT id FROM sessions WHERE workspace_id = ?)").run(workspaceId);
    this.db.query("DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE workspace_id = ?)").run(workspaceId);
    this.db.query("DELETE FROM sessions WHERE workspace_id = ?").run(workspaceId);
    this.db.query("DELETE FROM workspaces WHERE id = ?").run(workspaceId);
    return { ok: true, worktreePath: row.worktree_path };
  }

  sessionCreate(workspaceId: string): string {
    const id = this.ids.uuid("sess");
    const startedAt = Math.floor(this.ids.now() / 1000);
    this.db
      .query("INSERT INTO sessions (id, workspace_id, started_at) VALUES (?, ?, ?)")
      .run(id, workspaceId, startedAt);
    return id;
  }

  private latestSession(workspaceId: string): string | undefined {
    const row = this.db
      .query<SessionRow, [string]>(
        "SELECT id, workspace_id FROM sessions WHERE workspace_id = ? ORDER BY started_at DESC LIMIT 1"
      )
      .get(workspaceId);
    return row?.id;
  }

  messagesList(input: { sessionId: string; limit?: number; offset?: number }): Message[] {
    const limit = input.limit ?? 100;
    const offset = input.offset ?? 0;
    const rows = this.db
      .query<MessageRow, [string, number, number]>(
        "SELECT id, session_id, role, content, tool_calls_json, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?"
      )
      .all(input.sessionId, limit, offset);
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      role: r.role as Message["role"],
      content: r.content,
      toolCallsJson: r.tool_calls_json ?? undefined,
      createdAt: r.created_at,
    }));
  }

  messageAppend(input: {
    sessionId: string;
    role: "user" | "assistant" | "tool";
    content: string;
    toolCallsJson?: string;
  }): { id: string } {
    const id = this.ids.uuid("msg");
    const createdAt = Math.floor(this.ids.now() / 1000);
    this.db
      .query(
        "INSERT INTO messages (id, session_id, role, content, tool_calls_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(id, input.sessionId, input.role, input.content, input.toolCallsJson ?? null, createdAt);
    return { id };
  }

  notificationInsert(input: {
    workspaceId?: string | null;
    type: string;
    title: string;
    body: string;
  }): Notification {
    const id = this.ids.uuid("notif");
    const createdAt = Math.floor(this.ids.now() / 1000);
    this.db
      .query(
        "INSERT INTO notifications (id, workspace_id, type, title, body, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)"
      )
      .run(id, input.workspaceId ?? null, input.type, input.title, input.body, createdAt);
    return {
      id,
      workspaceId: input.workspaceId ?? null,
      type: input.type,
      title: input.title,
      body: input.body,
      read: false,
      createdAt,
    };
  }

  notificationList(input: { limit?: number; unreadOnly?: boolean } = {}): Notification[] {
    const limit = input.limit ?? 50;
    const where = input.unreadOnly ? "WHERE read = 0" : "";
    const rows = this.db
      .query<NotificationRow, [number]>(
        `SELECT id, workspace_id, type, title, body, read, created_at FROM notifications ${where} ORDER BY created_at DESC LIMIT ?`
      )
      .all(limit);
    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      type: r.type,
      title: r.title,
      body: r.body,
      read: r.read === 1,
      createdAt: r.created_at,
    }));
  }

  notificationMarkRead(input: { id: string }): { ok: true } {
    this.db.query("UPDATE notifications SET read = 1 WHERE id = ?").run(input.id);
    return { ok: true };
  }

  notificationMarkAllRead(): { ok: true } {
    this.db.run("UPDATE notifications SET read = 1 WHERE read = 0");
    return { ok: true };
  }

  notificationUnreadCount(): number {
    const row = this.db
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM notifications WHERE read = 0")
      .get();
    return row?.n ?? 0;
  }

  /**
   * Persist a layout as a named workspace preset in `workspace_presets`.
   * The owning project is resolved from `projectId` directly, or from the
   * workspace when only a `workspaceId` is known (save-current-layout flow).
   */
  presetSave(input: {
    name: string;
    layout: PresetNode;
    description?: string;
    baseBranch?: string;
    projectId?: string;
    workspaceId?: string;
  }): WorkspacePreset {
    const projectId =
      input.projectId ??
      (input.workspaceId ? this.workspaceGet(input.workspaceId)?.projectId ?? null : null);
    const id = this.ids.uuid("preset");
    const createdAt = Math.floor(this.ids.now() / 1000);
    this.db
      .query(
        "INSERT INTO workspace_presets (id, project_id, name, description, base_branch, layout_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        id,
        projectId,
        input.name,
        input.description ?? null,
        input.baseBranch ?? null,
        JSON.stringify(input.layout),
        createdAt
      );
    return {
      name: input.name,
      description: input.description,
      baseBranch: input.baseBranch,
      layout: input.layout,
    };
  }

  /** Presets persisted in the DB for a project (newest first). */
  presetList(projectId: string): WorkspacePreset[] {
    const rows = this.db
      .query<PresetRow, [string]>(
        "SELECT id, project_id, name, description, base_branch, layout_json, created_at FROM workspace_presets WHERE project_id = ? ORDER BY created_at DESC"
      )
      .all(projectId);
    return rows.map((r) => this.rowToPreset(r));
  }

  private rowToPreset(r: PresetRow): WorkspacePreset {
    return {
      name: r.name,
      description: r.description ?? undefined,
      baseBranch: r.base_branch ?? undefined,
      layout: JSON.parse(r.layout_json) as PresetNode,
    };
  }

  close(): void {
    this.db.close();
  }
}
