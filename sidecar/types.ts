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

export type WorkspaceMode = "terminal" | "agent";

export interface Workspace {
  id: string;
  projectId: string;
  branch: string;
  agentBackend: string;
  worktreePath: string;
  status: "active" | "idle" | "error";
  sessionId: string;
  title?: string;
  mode: WorkspaceMode;
}

export interface Message {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallsJson?: string;
  createdAt: number;
  partsJson?: string;
  turnId?: string;
}

export interface Checkpoint {
  id: string;
  sessionId: string;
  messageId: string;
  gitSha: string;
  providerSessionId: string | null;
  providerLineCount: number;
  createdAt: number;
}

// ---------- Agent Mode unified protocol ----------

export interface AgentFileChange {
  path: string;
  additions: number;
  deletions: number;
  kind: "edit" | "create" | "delete";
}

export type AgentPart =
  | { type: "text"; text: string }
  | { type: "thinking"; summary: string; text?: string }
  | {
      type: "tool-call";
      toolUseId: string;
      toolName: string;
      title: string;
      detail?: string;
      status: "running" | "ok" | "error";
      output?: string;
      fileChanges?: AgentFileChange[];
      durationMs?: number;
    }
  | { type: "attachment"; name: string; path: string; mime: string };

export interface AgentChatMessage {
  id: string;
  sessionId: string;
  turnId: string;
  role: "user" | "assistant" | "system";
  parts: AgentPart[];
  createdAt: number;
}

export interface QueuedMessage {
  id: string;
  parts: AgentPart[];
  createdAt: number;
}

export type AgentRunStatus = "idle" | "working" | "error";

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  durationMs: number;
}

export type AgentEvent =
  | { type: "session-meta"; providerSessionId: string; model: string }
  | { type: "message-start"; message: AgentChatMessage }
  | { type: "part-start"; messageId: string; partIndex: number; part: AgentPart }
  | { type: "part-delta"; messageId: string; partIndex: number; delta: string }
  | { type: "part-end"; messageId: string; partIndex: number; part: AgentPart }
  | { type: "message-end"; message: AgentChatMessage }
  | { type: "turn-end"; turnId: string; usage: AgentUsage }
  | { type: "status"; status: AgentRunStatus }
  | { type: "queue-updated"; queue: QueuedMessage[] }
  | { type: "permission-request"; requestId: string }
  | { type: "error"; message: string; recoverable: boolean };

export interface AgentEventPayload {
  workspaceId: string;
  sessionId: string;
  event: AgentEvent;
}

export interface AgentModelOption { id: string; label: string }
export interface AgentSlashCommand { name: string; description: string }

export interface AgentCapabilities {
  models: AgentModelOption[];
  reasoningLevels: AgentModelOption[];
  slashCommands: AgentSlashCommand[];
  supportsInterrupt: boolean;
  supportsConversationRewind: boolean;
}

export interface AgentSessionSnapshot {
  sessionId: string;
  workspaceId: string;
  status: AgentRunStatus;
  queue: QueuedMessage[];
  model: string | null;
  reasoningLevel: string | null;
  providerSessionId: string | null;
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

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export type MCPStatus = "running" | "stopped" | "error" | "crashed" | "restarting";

export interface MCPServer {
  name: string;
  command: string;
  args: string[];
  status: MCPStatus;
  pid?: number;
  restarts: number;
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

export interface FileWriteResult {
  mtime: number;
}

export interface FileAtRefResult {
  content: string;
  missing: boolean;
}

export interface Commit {
  sha: string;
  message: string;
  author: string;
  timestamp: number;
  fileCount: number;
}

export type GitProvider = "github" | "bitbucket" | "gitlab" | "unknown";

export interface RemoteInfo {
  provider: GitProvider;
  host: string;
  owner: string;
  repo: string;
  // Browser-openable repo root, e.g. https://github.com/owner/repo
  webUrl: string;
  remoteUrl: string;
}

export interface Stash {
  index: number;
  message: string;
  branch: string;
  timestamp: number;
}

export interface Branch {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
}

export interface BlameLine {
  sha: string;
  author: string;
  timestamp: number;
  lineNumber: number;
  content: string;
}

export interface ConflictHunk {
  filePath: string;
  hunkIndex: number;
  ours: string[];
  theirs: string[];
  base?: string[];
  /**
   * Set when the conflicted working-tree file could not be read as text (binary
   * content or an unreadable path). The resolver UI surfaces this as a
   * needs-manual-resolution entry instead of silently dropping the file.
   */
  binary?: boolean;
}

export type ConflictResolution = "ours" | "theirs" | "both";

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

export type CheckStatus = "pass" | "fail" | "pending" | "neutral";

export interface CheckItem {
  name: string;
  status: CheckStatus;
  detail?: string;
}

export interface PrInfo {
  number: number;
  url: string;
  state: string;
  title: string;
  mergeable: string;
}

export interface ChecksReport {
  git: {
    branch: string;
    ahead: number;
    behind: number;
    changedFiles: number;
    conflicts: number;
  };
  pr: PrInfo | null;
  ghAvailable: boolean;
  checks: CheckItem[];
  merge: { ready: boolean; blockers: string[] };
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

export interface BackendTokenUsage {
  backend: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  sessions: number;
}

export interface UsageSummary {
  /** Local calendar day the figures cover, YYYY-MM-DD. */
  date: string;
  backends: BackendTokenUsage[];
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
  run(
    cmd: string[],
    cwd?: string,
    stdin?: string,
    // `timeoutMs` kills the child once the budget elapses (exitCode 124), so a
    // hung CLI (`claude -p`, `gh`) can't orphan a subprocess or stall the sidecar.
    opts?: { timeoutMs?: number }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export interface IdProvider {
  uuid(prefix: string): string;
  now(): number;
}
