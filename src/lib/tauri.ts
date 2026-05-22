// Typed wrappers for Tauri invoke/listen
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Message,
  MaverickConfig,
  DiffResult,
  Commit,
  Stash,
  KanbanTask,
  DiffStat,
  WorkspacePreset,
  Workspace,
  Project,
  Skill,
  FileEntry,
  ContextUsage,
  MCPServer,
} from "./ipc";

export async function projectAdd(path: string): Promise<Project> {
  return invoke("project_add", { path });
}

export async function projectList(): Promise<Project[]> {
  return invoke("project_list");
}

export async function workspaceList(projectId?: string): Promise<Workspace[]> {
  return invoke("workspace_list", { projectId });
}

export async function workspaceCreate(
  projectId: string,
  branch: string,
  backend: string
): Promise<Workspace> {
  return invoke("workspace_create", { projectId, branch, backend });
}

export async function workspaceDestroy(workspaceId: string): Promise<void> {
  return invoke("workspace_destroy", { workspaceId });
}

export async function ptySpawn(
  workspaceId: string,
  command: string,
  args: string[],
  cwd?: string,
): Promise<{ ptyId: string }> {
  return invoke("pty_spawn", { workspaceId, command, args, cwd });
}

export async function ptyWrite(ptyId: string, data: string): Promise<void> {
  return invoke("pty_write", { ptyId, data });
}

export async function ptyResize(ptyId: string, cols: number, rows: number): Promise<void> {
  return invoke("pty_resize", { ptyId, cols, rows });
}

export async function ptyKill(ptyId: string): Promise<void> {
  return invoke("pty_kill", { ptyId });
}

export async function defaultShell(): Promise<string> {
  return invoke("default_shell");
}

export async function configLoad(projectPath: string): Promise<MaverickConfig> {
  return invoke("config_load", { projectPath });
}

export async function messagesList(
  sessionId: string,
  limit = 100,
  offset = 0
): Promise<Message[]> {
  return invoke("messages_list", { sessionId, limit, offset });
}

export async function messageAppend(
  sessionId: string,
  role: "user" | "assistant" | "tool",
  content: string,
  toolCallsJson?: string
): Promise<{ id: string }> {
  return invoke("message_append", { sessionId, role, content, toolCallsJson });
}

export async function skillsList(projectPath: string): Promise<Skill[]> {
  return invoke("skills_list", { projectPath });
}

export async function skillsRun(
  workspaceId: string,
  skillName: string,
  vars: Record<string, string>
): Promise<{ prompt: string }> {
  return invoke("skills_run", { workspaceId, skillName, vars });
}

export async function diffGet(worktreePath: string, filePath?: string): Promise<DiffResult> {
  return invoke("diff_get", { worktreePath, filePath });
}

export async function diffStageHunk(worktreePath: string, patch: string): Promise<void> {
  return invoke("diff_stage_hunk", { worktreePath, patch });
}

export async function diffUnstageHunk(worktreePath: string, patch: string): Promise<void> {
  return invoke("diff_unstage_hunk", { worktreePath, patch });
}

export async function gitLog(worktreePath: string, limit = 50): Promise<Commit[]> {
  return invoke("git_log", { worktreePath, limit });
}

export async function gitStashList(worktreePath: string): Promise<Stash[]> {
  return invoke("git_stash_list", { worktreePath });
}

export async function gitCommit(
  worktreePath: string,
  message: string,
  files?: string[]
): Promise<{ sha: string }> {
  return invoke("git_commit", { worktreePath, message, files });
}

export async function fileTree(worktreePath: string): Promise<FileEntry[]> {
  return invoke("file_tree", { worktreePath });
}

export async function kanbanList(projectId: string): Promise<KanbanTask[]> {
  return invoke("kanban_list", { projectId });
}

export async function kanbanUpsert(task: Partial<KanbanTask>): Promise<KanbanTask> {
  return invoke("kanban_upsert", { task });
}

export async function presetList(projectPath?: string): Promise<WorkspacePreset[]> {
  return invoke("preset_list", { projectPath });
}

export async function presetLaunch(
  preset: WorkspacePreset,
  projectId: string,
  branch?: string
): Promise<{ workspaceId: string }> {
  return invoke("preset_launch", { preset, projectId, branch });
}

export async function presetSaveCurrent(
  workspaceId: string,
  name: string
): Promise<WorkspacePreset> {
  return invoke("preset_save_current", { workspaceId, name });
}

export async function mcpStart(name: string): Promise<{ pid: number }> {
  return invoke("mcp_start", { name });
}

export async function mcpStop(name: string): Promise<void> {
  return invoke("mcp_stop", { name });
}

export async function mcpList(): Promise<MCPServer[]> {
  return invoke("mcp_list");
}

export async function contextUsage(sessionId: string): Promise<ContextUsage> {
  return invoke("context_usage", { sessionId });
}

export async function attachmentCreate(
  worktreePath: string,
  text: string
): Promise<{ filePath: string; ref: string }> {
  return invoke("attachment_create", { worktreePath, text });
}

export async function automationRun(
  automationName: string,
  workspaceId: string
): Promise<void> {
  return invoke("automation_run", { automationName, workspaceId });
}

export async function notifySend(
  title: string,
  body: string,
  workspaceId?: string
): Promise<void> {
  return invoke("notify_send", { title, body, workspaceId });
}

export async function gitBranches(projectPath: string): Promise<string[]> {
  return invoke("git_branches", { projectPath });
}

export async function gitDiffStat(worktreePath: string): Promise<DiffStat> {
  return invoke("git_diff_stat", { worktreePath });
}

// Event subscriptions

export function onPtyData(
  callback: (payload: { ptyId: string; data: string }) => void
): Promise<UnlistenFn> {
  return listen<{ ptyId: string; data: string }>("pty:data", (e) => callback(e.payload));
}

export function onPtyExit(
  callback: (payload: { ptyId: string; code: number }) => void
): Promise<UnlistenFn> {
  return listen<{ ptyId: string; code: number }>("pty:exit", (e) => callback(e.payload));
}

export function onWorkspaceStatus(
  callback: (payload: { workspaceId: string; status: string }) => void
): Promise<UnlistenFn> {
  return listen<{ workspaceId: string; status: string }>("workspace:status", (e) =>
    callback(e.payload)
  );
}
