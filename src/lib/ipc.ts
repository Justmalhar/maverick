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
  ui: Record<string, string>;
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

export interface KanbanTask {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: "backlog" | "in_progress" | "review" | "done";
  columnOrder: number;
  workspaceId?: string;
  labels: string[];
  dueDate?: number;
  createdAt: number;
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

export interface MCPServer {
  name: string;
  command: string;
  args: string[];
  status: "running" | "stopped" | "error";
  pid?: number;
}

export interface ContextUsage {
  workspaceId: string;
  tokensUsed: number;
  contextWindow: number;
  sessionCostEstimate: number;
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

export type AuxiliaryView = "files" | "diff" | "preview" | "none";
