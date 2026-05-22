import type {
  Project,
  Workspace,
  Backend,
  Skill,
  KanbanTask,
  SplitNode,
  Message,
  Commit,
  Stash,
  FileEntry,
  WorkspacePreset,
  PresetNode,
  MCPServer,
  DiffResult,
  DiffFile,
  Automation,
  AutomationStep,
} from "@/lib/ipc";

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "demo",
    path: "/tmp/demo",
    createdAt: 1700000000,
    ...overrides,
  };
}

export function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws-1",
    projectId: "proj-1",
    branch: "main",
    agentBackend: "claude",
    worktreePath: "/tmp/demo/.maverick/worktrees/ws-1",
    status: "active",
    sessionId: "sess-1",
    title: "main",
    ...overrides,
  };
}

export function makeBackend(overrides: Partial<Backend> = {}): Backend {
  return {
    id: "claude",
    name: "claude",
    command: "claude",
    args: [],
    env: {},
    active: true,
    ...overrides,
  };
}

export function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: "review",
    description: "Review the diff",
    prompt: "Please review the changes.",
    ...overrides,
  };
}

export function makeKanbanTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: "task-1",
    projectId: "proj-1",
    title: "Do the thing",
    description: "details",
    status: "todo",
    columnOrder: 0,
    labels: [],
    createdAt: 1700000000,
    agentBackend: "claude",
    branch: "main",
    attachments: [],
    ...overrides,
  };
}

export function makeSplitNode(overrides: Partial<SplitNode> = {}): SplitNode {
  return {
    type: "terminal",
    id: "p1",
    backend: "shell",
    ptyId: "pty-1",
    ...overrides,
  } as SplitNode;
}

export function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    sessionId: "sess-1",
    role: "user",
    content: "hello",
    createdAt: 1700000000,
    ...overrides,
  };
}

export function makeCommit(overrides: Partial<Commit> = {}): Commit {
  return {
    sha: "abcdef1234567890",
    message: "Initial commit",
    author: "Malhar",
    timestamp: 1700000000,
    fileCount: 1,
    ...overrides,
  };
}

export function makeStash(overrides: Partial<Stash> = {}): Stash {
  return {
    index: 0,
    message: "WIP",
    branch: "main",
    timestamp: 1700000000,
    ...overrides,
  };
}

export function makeFileEntry(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    path: "src/index.ts",
    name: "index.ts",
    isDirectory: false,
    ...overrides,
  };
}

export function makeDiffFile(overrides: Partial<DiffFile> = {}): DiffFile {
  return {
    path: "src/a.ts",
    status: "M",
    additions: 1,
    deletions: 0,
    hunks: [
      {
        header: "@@ -1 +1 @@",
        lines: ["-old", "+new", " ctx"],
        patch: "@@ -1 +1 @@\n-old\n+new\n ctx",
      },
    ],
    ...overrides,
  };
}

export function makeDiff(overrides: Partial<DiffResult> = {}): DiffResult {
  return {
    files: [makeDiffFile()],
    ...overrides,
  };
}

export function makePreset(overrides: Partial<WorkspacePreset> = {}): WorkspacePreset {
  const layout: PresetNode = { type: "terminal", agent: "claude", cwd: "{{workspace_root}}", mode: "agent" };
  return {
    name: "default",
    description: "Default layout",
    baseBranch: "main",
    layout,
    ...overrides,
  };
}

export function makeMCPServer(overrides: Partial<MCPServer> = {}): MCPServer {
  return {
    name: "fs",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    status: "stopped",
    ...overrides,
  };
}

export function makeAutomationStep(overrides: Partial<AutomationStep> = {}): AutomationStep {
  return { type: "shell", command: "echo hi", ...overrides } as AutomationStep;
}

export function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    name: "build",
    trigger: "manual",
    steps: [makeAutomationStep()],
    ...overrides,
  };
}
