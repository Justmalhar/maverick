import { Database } from "bun:sqlite";
import { readdirSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { defaultIds } from "./deps";
import type { IdProvider, Project, Workspace, Message } from "./types";

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
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const sql = readFileSync(join(dir, file), "utf8");
      this.db.exec(sql);
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

  workspaceCreate(input: {
    id?: string;
    projectId: string;
    branch: string;
    agentBackend: string;
    worktreePath: string;
  }): Workspace {
    const id = input.id ?? this.ids.uuid("ws");
    const createdAt = Math.floor(this.ids.now() / 1000);
    this.db
      .query(
        "INSERT INTO workspaces (id, project_id, branch, agent_backend, worktree_path, status, created_at) VALUES (?, ?, ?, ?, ?, 'idle', ?)"
      )
      .run(id, input.projectId, input.branch, input.agentBackend, input.worktreePath, createdAt);
    const sessionId = this.sessionCreate(id);
    return {
      id,
      projectId: input.projectId,
      branch: input.branch,
      agentBackend: input.agentBackend,
      worktreePath: input.worktreePath,
      status: "idle",
      sessionId,
    };
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

  close(): void {
    this.db.close();
  }
}
