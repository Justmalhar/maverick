// Typed wrappers for Tauri invoke/listen
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  BlameLine,
  BootstrapStatus,
  Branch,
  Commit,
  ConflictHunk,
  ConflictResolution,
  ContextUsage,
  DetectedBackend,
  DiffResult,
  DiffStat,
  FileEntry,
  FileReadResult,
  FsChangedPayload,
  KanbanTask,
  SearchResult,
  MaverickConfig,
  MaverickSettings,
  MCPServer,
  Message,
  Notification,
  NotificationPermission,
  Project,
  ResolvedInstructions,
  ProjectSettings,
  SettingsPatch,
  Skill,
  Stash,
  UsageSummary,
  Workspace,
  WorkspacePreset,
  PresetNode,
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
  projectPath: string,
  branch: string,
  backend: string,
  baseBranch?: string
): Promise<Workspace> {
  return invoke("workspace_create", {
    projectId,
    projectPath,
    branch,
    backend,
    baseBranch,
  });
}

export async function workspaceDestroy(workspaceId: string): Promise<void> {
  return invoke("workspace_destroy", { workspaceId });
}

export async function ptySpawn(
  command: string,
  args: string[],
  cwd?: string,
  env?: Record<string, string>
): Promise<{ ptyId: string }> {
  return invoke("pty_spawn", { command, args, cwd, env });
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

export async function configSave(
  projectPath: string,
  patch: Partial<MaverickConfig>
): Promise<MaverickConfig> {
  return invoke("config_save", { projectPath, patch });
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

export async function diffGet(
  worktreePath: string,
  filePath?: string,
  staged?: boolean
): Promise<DiffResult> {
  return invoke("diff_get", { worktreePath, filePath, staged });
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

export async function fileRead(filePath: string): Promise<FileReadResult> {
  return invoke("file_read", { filePath });
}

export async function fileSearch(
  worktreePath: string,
  query: string,
  limit?: number
): Promise<SearchResult> {
  return invoke("file_search", { worktreePath, query, limit });
}

export async function fsWatchStart(
  root: string,
  dirs?: string[]
): Promise<{ watching: number }> {
  return invoke("fs_watch_start", { root, dirs });
}

export async function fsWatchAdd(dirs: string[]): Promise<{ watching: number }> {
  return invoke("fs_watch_add", { dirs });
}

export async function fsWatchRemove(dirs: string[]): Promise<{ watching: number }> {
  return invoke("fs_watch_remove", { dirs });
}

export async function fsWatchStop(): Promise<{ ok: true }> {
  return invoke("fs_watch_stop");
}

export function onFsChanged(
  callback: (payload: FsChangedPayload) => void
): Promise<UnlistenFn> {
  return listen<FsChangedPayload>("fs:changed", (e) => callback(e.payload));
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

export async function projectSettingsGet(projectId: string): Promise<ProjectSettings> {
  return invoke("project_settings_get", { projectId });
}

export async function projectSettingsUpdate(
  projectId: string,
  patch: Partial<ProjectSettings>
): Promise<ProjectSettings> {
  return invoke("project_settings_update", { projectId, patch });
}

export async function projectSettingsOpenFile(projectId: string): Promise<{ path: string }> {
  return invoke("project_settings_open_file", { projectId });
}

export async function presetLaunch(
  preset: WorkspacePreset,
  projectPath: string,
  branch?: string
): Promise<{ workspaceId: string }> {
  return invoke("preset_launch", { preset, projectPath, branch });
}

export async function presetSaveCurrent(
  workspaceId: string,
  name: string,
  layout: PresetNode,
  description?: string
): Promise<WorkspacePreset> {
  return invoke("preset_save_current", { workspaceId, name, layout, description });
}

export async function mcpStart(
  name: string,
  workspaceId?: string,
  projectPath?: string
): Promise<{ pid: number }> {
  return invoke("mcp_start", { name, workspaceId, projectPath });
}

export async function mcpStop(name: string): Promise<void> {
  return invoke("mcp_stop", { name });
}

export async function mcpList(): Promise<MCPServer[]> {
  return invoke("mcp_list");
}

export interface MCPLogPage {
  data: string;
  nextOffset: number;
  dropped: number;
}

export async function mcpLogs(name: string, sinceOffset = 0): Promise<MCPLogPage> {
  return invoke("mcp_logs", { name, sinceOffset });
}

export async function mcpAdd(
  name: string,
  command: string,
  args: string[],
  env: Record<string, string>,
  workspaceId?: string,
  projectPath?: string
): Promise<{ ok: true }> {
  return invoke("mcp_add", { name, command, args, env, workspaceId, projectPath });
}

export function onMcpStatus(
  callback: (payload: {
    name: string;
    status: MCPServer["status"];
    restarts: number;
    exitCode: number;
  }) => void
): Promise<UnlistenFn> {
  return listen<{ name: string; status: MCPServer["status"]; restarts: number; exitCode: number }>(
    "mcp:status",
    (e) => callback(e.payload)
  );
}

export async function contextUsage(sessionId: string): Promise<ContextUsage> {
  return invoke("context_usage", { sessionId });
}

export async function usageSummary(): Promise<UsageSummary> {
  return invoke("usage_summary");
}

export async function contextRecord(
  sessionId: string,
  tokensUsed: number,
  costEstimate: number
): Promise<ContextUsage> {
  return invoke("context_record", { sessionId, tokensUsed, costEstimate });
}

export async function attachmentCreate(
  worktreePath: string,
  text: string
): Promise<{ filePath: string; ref: string }> {
  return invoke("attachment_create", { worktreePath, text });
}

export async function automationRun(
  automationName: string,
  workspaceId?: string,
  projectPath?: string,
  worktreePath?: string
): Promise<void> {
  return invoke("automation_run", { automationName, workspaceId, projectPath, worktreePath });
}

export async function notifySend(
  title: string,
  body: string,
  workspaceId?: string,
  type?: string
): Promise<Notification | { ok: true }> {
  return invoke("notify_send", { title, body, workspaceId, type });
}

export async function notifyList(
  limit?: number,
  unreadOnly?: boolean
): Promise<Notification[]> {
  return invoke("notify_list", { limit, unreadOnly });
}

export async function notifyMarkRead(id: string): Promise<void> {
  await invoke("notify_mark_read", { id });
}

export async function notifyMarkAllRead(): Promise<void> {
  await invoke("notify_mark_all_read");
}

export async function notifyUnreadCount(): Promise<number> {
  const result = await invoke<{ count: number }>("notify_unread_count");
  return result.count;
}

export function onNotificationSend(
  callback: (n: Notification) => void
): Promise<UnlistenFn> {
  return listen<Notification>("notification:send", (e) => callback(e.payload));
}

export async function caffeinateStart(): Promise<{ active: boolean }> {
  return invoke("caffeinate_start");
}

export async function caffeinateStop(): Promise<{ active: boolean }> {
  return invoke("caffeinate_stop");
}

export async function caffeinateStatus(): Promise<{ active: boolean }> {
  return invoke("caffeinate_status");
}

export async function instructionsResolve(
  worktreePath: string
): Promise<ResolvedInstructions> {
  return invoke("instructions_resolve", { worktreePath });
}

export async function prCreate(
  worktreePath: string,
  title?: string,
  body?: string,
  base?: string
): Promise<{ url: string }> {
  return invoke("pr_create", { worktreePath, title, body, base });
}

// Embedded Browser (native child webview) controls.
export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function browserOpen(url: string, bounds: BrowserBounds): Promise<void> {
  await invoke("browser_open", { url, ...bounds });
}

export async function browserNavigate(url: string): Promise<void> {
  await invoke("browser_navigate", { url });
}

export async function browserSetBounds(bounds: BrowserBounds): Promise<void> {
  await invoke("browser_set_bounds", { ...bounds });
}

export async function browserShow(): Promise<void> {
  await invoke("browser_show");
}

export async function browserHide(): Promise<void> {
  await invoke("browser_hide");
}

export async function browserClose(): Promise<void> {
  await invoke("browser_close");
}

export async function browserEval(script: string): Promise<void> {
  await invoke("browser_eval", { script });
}

export function onBrowserElementCaptured(
  callback: (payload: { selector: string; text: string; html: string }) => void
): Promise<UnlistenFn> {
  return listen<{ selector: string; text: string; html: string }>("browser://captured", (e) =>
    callback(e.payload)
  );
}

export async function gitBranches(projectPath: string): Promise<string[]> {
  return invoke("git_branches", { projectPath });
}

export async function gitDiffStat(worktreePath: string): Promise<DiffStat> {
  return invoke("git_diff_stat", { worktreePath });
}

export async function gitBranchList(worktreePath: string): Promise<Branch[]> {
  return invoke("git_branch_list", { worktreePath });
}

export async function gitCheckout(worktreePath: string, branch: string): Promise<{ ok: true }> {
  return invoke("git_checkout", { worktreePath, branch });
}

export async function gitBlame(worktreePath: string, filePath: string): Promise<BlameLine[]> {
  return invoke("git_blame", { worktreePath, filePath });
}

export async function gitCherryPick(worktreePath: string, sha: string): Promise<{ ok: true }> {
  return invoke("git_cherry_pick", { worktreePath, sha });
}

export async function gitStashApply(worktreePath: string, index: number): Promise<{ ok: true }> {
  return invoke("git_stash_apply", { worktreePath, index });
}

export async function gitStashPop(worktreePath: string, index: number): Promise<{ ok: true }> {
  return invoke("git_stash_pop", { worktreePath, index });
}

export async function gitStashDrop(worktreePath: string, index: number): Promise<{ ok: true }> {
  return invoke("git_stash_drop", { worktreePath, index });
}

export async function gitConflicts(worktreePath: string): Promise<ConflictHunk[]> {
  return invoke("git_conflicts", { worktreePath });
}

export async function gitResolveConflict(
  worktreePath: string,
  filePath: string,
  hunkIndex: number,
  resolution: ConflictResolution
): Promise<{ ok: true }> {
  return invoke("git_resolve_conflict", { worktreePath, filePath, hunkIndex, resolution });
}

export async function gitFetch(worktreePath: string, remote?: string): Promise<{ ok: true }> {
  return invoke("git_fetch", { worktreePath, remote });
}

export async function gitPull(worktreePath: string): Promise<{ ok: true }> {
  return invoke("git_pull", { worktreePath });
}

export async function gitPush(
  worktreePath: string,
  remote?: string,
  branch?: string
): Promise<{ ok: true }> {
  return invoke("git_push", { worktreePath, remote, branch });
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

export function onProjectSettingsChanged(
  callback: (payload: { projectId: string; settings: ProjectSettings }) => void
): Promise<UnlistenFn> {
  return listen<{ projectId: string; settings: ProjectSettings }>(
    "project:settings:changed",
    (e) => callback(e.payload)
  );
}

// Bootstrap commands

export async function bootstrapStatus(): Promise<BootstrapStatus> {
  return invoke("bootstrap_status");
}

export async function bootstrapUpdateSettings(
  patch: SettingsPatch
): Promise<MaverickSettings> {
  return invoke("bootstrap_update_settings", { patch });
}

export async function bootstrapComplete(): Promise<{ firstRunCompletedAt: number }> {
  return invoke("bootstrap_complete");
}

export async function resetFirstRun(): Promise<void> {
  await invoke<void>("reset_first_run");
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("maverick:firstrun:reset"));
  }
}

export async function detectBackends(): Promise<DetectedBackend[]> {
  return invoke("detect_backends");
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  return invoke("request_notification_permission");
}

export async function readMaverickMd(): Promise<string> {
  return invoke("read_maverick_md");
}

export async function writeMaverickMd(contents: string): Promise<void> {
  return invoke("write_maverick_md", { contents });
}
