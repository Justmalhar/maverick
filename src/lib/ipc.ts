// Shared IPC type definitions — mirrors SYSTEM-DESIGN.md §4.2
// Must stay in sync with sidecar/types.ts

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
  title?: string;
}

export interface Backend {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  active: boolean;
}

export type EditorMode = "agent" | "terminal";

export interface ThemeDefinition {
  name: string;
  type: "dark" | "light";
  /** Legacy format — small set of opaque CSS vars */
  ui?: Record<string, string>;
  /** VSCode-compatible format — hex colors keyed by VSCode color ID */
  colors?: Record<string, string>;
  /** VSCode tokenColors (stored for future syntax highlighting use) */
  tokenColors?: Array<{ scope: string | string[]; settings: Record<string, string> }>;
  semanticHighlighting?: boolean;
  terminal: TerminalTheme;
  syntax: Record<string, string>;
}

export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface Skill {
  name: string;
  description: string;
  prompt: string;
  backend?: string;
}

export type KeybindingMap = Record<string, string>;

export type SplitNode =
  | { type: "terminal"; id: string; backend: string; ptyId: string }
  | {
      type: "split";
      direction: "h" | "v";
      ratio: number;
      left: SplitNode;
      right: SplitNode;
    };

export interface Message {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallsJson?: string;
  createdAt: number;
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

export interface Automation {
  name: string;
  trigger: "manual" | "schedule" | "on-file-change";
  steps: AutomationStep[];
}

export interface AutomationStep {
  type: "shell" | "skill" | "git" | "workspace" | "notify" | "url";
  [key: string]: unknown;
}

export type MCPStatus = "running" | "stopped" | "error" | "crashed" | "restarting";

export interface MCPServer {
  name: string;
  command: string;
  args: string[];
  status: MCPStatus;
  pid?: number;
  restarts?: number;
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

export interface WorkspacePreset {
  name: string;
  description?: string;
  baseBranch?: string;
  layout: PresetNode;
}

export type PresetNode =
  | { type: "terminal"; agent: string; cwd: string; startup?: string; mode: EditorMode }
  | { type: "browser"; url?: string }
  | { type: "split"; direction: "h" | "v"; ratio: number; top: PresetNode; bottom: PresetNode }
  | { type: "split"; direction: "h" | "v"; ratio: number; left: PresetNode; right: PresetNode };

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
}

export type ConflictResolution = "ours" | "theirs" | "both";

export interface FileEntry {
  path: string;
  name: string;
  status?: "M" | "A" | "D" | "R";
  isDirectory: boolean;
  children?: FileEntry[];
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
  mcps?: MCPServer[];
}

export type ActivityView =
  | "dashboard"
  | "tasks"
  | "projects"
  | "automations"
  | "mcps"
  | "git"
  | "kanban"
  | "browser"
  | "settings";

export type AuxiliaryView = "files" | "diff" | "scm" | "preview" | "none";

export type GitProvider = "github" | "bitbucket" | "gitlab" | "unknown";

export interface RemoteInfo {
  provider: GitProvider;
  host: string;
  owner: string;
  repo: string;
  webUrl: string;
  remoteUrl: string;
}

export interface FileReadResult {
  content: string;
  size: number;
  binary: boolean;
  unreadable: boolean;
}

export interface SearchHit {
  rel: string;
  name: string;
  // QuickOpen is a files-only finder; the sidecar never emits directory hits,
  // so this is always false. Kept for IPC-type parity with FileEntry.
  isDirectory: false;
}

export interface SearchResult {
  hits: SearchHit[];
  truncated: boolean;
}

export interface FsChangedPayload {
  root: string;
  paths: string[];
}

// ---------- Settings ----------

export type SettingsKey =
  | "general.defaultBackend"
  | "general.defaultBackendBinPath"
  | "general.defaultBranch"
  | "general.namingScheme"
  | "general.restoreSession"
  | "general.env"
  | "appearance.theme"
  | "appearance.uiFontSize"
  | "appearance.terminalFontSize"
  | "appearance.ligatures"
  | "appearance.animations"
  | "appearance.customColors.background"
  | "appearance.customColors.foreground"
  | "appearance.customColors.accent"
  | "appearance.customColors.muted"
  | "appearance.customColors.border"
  | "appearance.customColors.card"
  | "appearance.customColors.sidebar"
  | "appearance.customColors.statusbar"
  | "notifications.agent.waiting"
  | "notifications.agent.complete"
  | "notifications.agent.error"
  | "notifications.build.result"
  | "notifications.quota.warning"
  | "git.remote"
  | "git.template"
  | "git.autoFetchMinutes"
  | "git.gpgSign"
  | "models.claude.id"
  | "models.codex.id"
  | "models.gemini.id"
  | "models.pi.id"
  | "terminal.claude.command"
  | "terminal.codex.command"
  | "terminal.gemini.command"
  | "terminal.pi.command"
  | "advanced.largeTextThreshold"
  | "advanced.lruLimit"
  | "advanced.caffeinate"
  | "browser.engine"
  | "version.updateChannel";

export type SettingsValue = string | number | boolean;

export interface SettingsWriteRequest {
  key: SettingsKey;
  value: SettingsValue;
}

export type SettingsWriteResponse =
  | { ok: true }
  | { ok: false; error: string };

export type SettingsSnapshot = Partial<Record<SettingsKey, SettingsValue>>;

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

export interface MaverickSettings {
  schemaVersion: number;
  wizardVersion: number;
  firstRunCompletedAt: number | null;
  theme: string;
  defaultBackend: string | null;
  notificationsRequestedAt: number | null;
  /**
   * Global environment variables merged into every PTY spawn. Per-workspace /
   * per-project env overrides these when keys collide. Persisted in the
   * settings store under the `general.env` key as a JSON-encoded string, so
   * it is absent from the bootstrap payload (hence optional here).
   */
  globalEnv?: Record<string, string>;
}

export type NotificationPermission = "granted" | "denied" | "default" | "unavailable";

export interface Notification {
  id: string;
  workspaceId: string | null;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: number;
}

export interface ResolvedInstructions {
  /** Project-local instructions (MAVERICK.md → CLAUDE.md → AGENTS.md), comments stripped. */
  project: string;
  /** Which project file matched, or null if none. */
  projectSource: string | null;
  /** Global ~/.maverick/MAVERICK.md instructions, comments stripped. */
  global: string;
}

export interface BootstrapPaths {
  configRoot: string;
  dbPath: string;
  logsDir: string;
}

export interface BootstrapStatus {
  ok: boolean;
  error: string | null;
  firstRun: boolean;
  wizardVersion: number;
  currentWizardVersion: number;
  paths: BootstrapPaths;
  settings: MaverickSettings;
  notificationPermission: NotificationPermission;
}

export type KnownBackendName =
  | "claude-code"
  | "codex"
  | "gemini"
  | "aider"
  | "opencode"
  | "antigravity"
  | "ollama";

export interface DetectedBackend {
  name: KnownBackendName;
  command: string;
  installed: boolean;
  path: string | null;
  version: string | null;
}

export interface SettingsPatch {
  theme?: string;
  defaultBackend?: string;
  notificationsRequestedAt?: number;
}
