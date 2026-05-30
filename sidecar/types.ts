export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params: Record<string, unknown>;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number | string;
  result?: T;
  error?: { code: number; message: string };
}

export interface JsonRpcNotification<T = unknown> {
  jsonrpc: "2.0";
  method: string;
  params: T;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
}

export interface Workspace {
  id: string;
  projectId: string;
  branch: string;
  agentBackend: string;
  worktreePath: string;
  status: "active" | "idle" | "error";
  sessionId: string;
}

export interface Message {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallsJson?: string;
  createdAt: number;
}

export interface Skill {
  name: string;
  description: string;
  prompt: string;
  backend?: string;
}

export interface MaverickConfig {
  version: number;
  backends: {
    default: string;
    available: Array<{ name: string; command: string; args: string[] }>;
  };
  worktrees?: { base: string };
  skills?: Skill[];
  presets?: WorkspacePreset[];
  automations?: Automation[];
  mcps?: MCPServerConfig[];
  project?: ProjectSettings;
}

export interface ProjectSettings {
  name: string;
  rootPath: string;
  workspaces: {
    basePath?: string;
    branchFrom: string;
    filesToCopy: string[];
  };
  remote: string;
  previewUrl: string;
  scripts: { setup: string; run: string; archive: string };
  preferences: Record<string, string>;
}

export interface WorkspacePreset {
  name: string;
  description?: string;
  baseBranch?: string;
  layout: PresetNode;
}

export type PresetNode =
  | { type: "terminal"; agent: string; cwd: string; startup?: string; mode: "agent" | "terminal" }
  | { type: "browser"; url?: string }
  | { type: "split"; direction: "h" | "v"; ratio: number; top: PresetNode; bottom: PresetNode }
  | { type: "split"; direction: "h" | "v"; ratio: number; left: PresetNode; right: PresetNode };

export interface Automation {
  name: string;
  trigger: "manual" | "schedule" | "on-file-change";
  steps: AutomationStep[];
}

export interface AutomationStep {
  type: "shell" | "skill" | "git" | "workspace" | "notify" | "url";
  [key: string]: unknown;
}

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface MCPServer {
  name: string;
  command: string;
  args: string[];
  status: "running" | "stopped" | "error";
  pid?: number;
}

export interface DiffResult {
  files: DiffFile[];
}

export interface DiffFile {
  path: string;
  status: "M" | "A" | "D" | "R";
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  header: string;
  lines: string[];
  patch: string;
}

export interface Commit {
  sha: string;
  message: string;
  author: string;
  timestamp: number;
  fileCount: number;
}

export interface Stash {
  index: number;
  message: string;
  branch: string;
  timestamp: number;
}

export interface Attachment {
  name: string;
  content: string;
  encoding: "utf8" | "base64";
  size: number;
}

export interface DiffStat {
  added: number;
  removed: number;
}

export interface KanbanTask {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: "todo" | "in_progress" | "review" | "done";
  columnOrder: number;
  workspaceId?: string;
  labels: string[];
  dueDate?: number;
  createdAt: number;
  agentBackend: string;
  branch: string;
  attachments: Attachment[];
}

export interface ContextUsage {
  workspaceId: string;
  tokensUsed: number;
  contextWindow: number;
  sessionCostEstimate: number;
}

export interface Notification {
  id: string;
  workspaceId: string | null;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: number;
}

export interface FileEntry {
  path: string;
  name: string;
  status?: "M" | "A" | "D" | "R";
  isDirectory: boolean;
  children?: FileEntry[];
}

export interface Backend {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  active: boolean;
}

export interface Notifier {
  write(line: string): void;
}

export interface Shell {
  text(cmd: string[], cwd?: string): Promise<string>;
  run(cmd: string[], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export interface IdProvider {
  uuid(prefix: string): string;
  now(): number;
}
