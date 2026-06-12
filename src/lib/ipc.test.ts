import { describe, it, expect, expectTypeOf, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  projectSettingsGet,
  projectSettingsUpdate,
  projectSettingsOpenFile,
} from "./tauri";
import type {
  Project, Workspace, Backend, Skill, Message, KanbanTask, MCPServer,
  WorkspacePreset, DiffResult, Commit, Stash, FileEntry, MaverickConfig,
  SplitNode, ContextUsage, Automation, AutomationStep,
  AuxiliaryView, ThemeDefinition, TerminalTheme, EditorMode, KeybindingMap,
  PresetNode, DiffFile, DiffHunk,
  Branch, BlameLine, ConflictHunk, ConflictResolution,
} from "./ipc";

describe("ipc types", () => {
  it("Project has the expected shape", () => {
    const p: Project = { id: "1", name: "n", path: "/p", createdAt: 0 };
    expectTypeOf(p.id).toBeString();
    expectTypeOf(p.name).toBeString();
    expectTypeOf(p.path).toBeString();
    expectTypeOf(p.createdAt).toBeNumber();
  });

  it("Workspace status union compiles", () => {
    const w: Workspace = {
      id: "1", projectId: "p", branch: "main", agentBackend: "claude",
      worktreePath: "/", status: "active", sessionId: "s", title: "t",
    };
    expectTypeOf(w.status).toEqualTypeOf<"active" | "idle" | "error">();
  });

  it("supports all type discriminants", () => {
    const backend: Backend = { id: "1", name: "a", command: "x", args: [], env: {}, active: true };
    const skill: Skill = { name: "s", description: "d", prompt: "p" };
    const msg: Message = { id: "1", sessionId: "s", role: "user", content: "", createdAt: 0 };
    const task: KanbanTask = {
      id: "1", projectId: "p", title: "t", status: "todo",
      columnOrder: 0, labels: [], createdAt: 0,
      agentBackend: "claude", branch: "main", attachments: [],
    };
    const mcp: MCPServer = { name: "n", command: "c", args: [], status: "running", restarts: 0 };
    const preset: WorkspacePreset = {
      name: "p", layout: { type: "terminal", agent: "a", cwd: "/", mode: "agent" },
    };
    const diff: DiffResult = { files: [] };
    const commit: Commit = { sha: "s", message: "m", author: "a", timestamp: 0, fileCount: 0 };
    const stash: Stash = { index: 0, message: "m", branch: "b", timestamp: 0 };
    const file: FileEntry = { path: "p", name: "n", isDirectory: false };
    const cfg: MaverickConfig = { version: 1, backends: { default: "x", available: [] } };
    const node: SplitNode = { type: "terminal", id: "1", backend: "shell", ptyId: "" };
    const ctx: ContextUsage = { workspaceId: "w", tokensUsed: 0, contextWindow: 0, sessionCostEstimate: 0 };
    const auto: Automation = { name: "a", trigger: "manual", steps: [] };
    const step: AutomationStep = { type: "shell" };
    const auxView: AuxiliaryView = "files";
    const mode: EditorMode = "agent";
    const km: KeybindingMap = {};
    const pn: PresetNode = { type: "browser", url: "x" };
    const df: DiffFile = { path: "p", status: "M", additions: 0, deletions: 0, hunks: [] };
    const dh: DiffHunk = { header: "@", lines: [], patch: "" };
    const td: ThemeDefinition = { name: "n", type: "dark", ui: {}, terminal: {} as TerminalTheme, syntax: {} };
    const br: Branch = { name: "main", isRemote: false, isCurrent: true, upstream: "origin/main", ahead: 1, behind: 0 };
    const bl: BlameLine = { sha: "s", author: "a", timestamp: 0, lineNumber: 1, content: "x" };
    const ch: ConflictHunk = { filePath: "f", hunkIndex: 0, ours: [], theirs: [], base: [] };
    const cr: ConflictResolution = "both";
    expectTypeOf(br).toMatchTypeOf<Branch>();
    expectTypeOf(bl).toMatchTypeOf<BlameLine>();
    expectTypeOf(ch).toMatchTypeOf<ConflictHunk>();
    expectTypeOf(cr).toMatchTypeOf<ConflictResolution>();
    expect(cr).toBe("both");
    expectTypeOf(backend).toMatchTypeOf<Backend>();
    expectTypeOf(skill).toMatchTypeOf<Skill>();
    expectTypeOf(msg).toMatchTypeOf<Message>();
    expectTypeOf(task).toMatchTypeOf<KanbanTask>();
    expectTypeOf(mcp).toMatchTypeOf<MCPServer>();
    expectTypeOf(preset).toMatchTypeOf<WorkspacePreset>();
    expectTypeOf(diff).toMatchTypeOf<DiffResult>();
    expectTypeOf(commit).toMatchTypeOf<Commit>();
    expectTypeOf(stash).toMatchTypeOf<Stash>();
    expectTypeOf(file).toMatchTypeOf<FileEntry>();
    expectTypeOf(cfg).toMatchTypeOf<MaverickConfig>();
    expectTypeOf(node).toMatchTypeOf<SplitNode>();
    expectTypeOf(ctx).toMatchTypeOf<ContextUsage>();
    expectTypeOf(auto).toMatchTypeOf<Automation>();
    expectTypeOf(step).toMatchTypeOf<AutomationStep>();
    expectTypeOf(auxView).toMatchTypeOf<AuxiliaryView>();
    expectTypeOf(mode).toMatchTypeOf<EditorMode>();
    expectTypeOf(km).toMatchTypeOf<KeybindingMap>();
    expectTypeOf(pn).toMatchTypeOf<PresetNode>();
    expectTypeOf(df).toMatchTypeOf<DiffFile>();
    expectTypeOf(dh).toMatchTypeOf<DiffHunk>();
    expectTypeOf(td).toMatchTypeOf<ThemeDefinition>();
  });

  it("projectSettings IPC wrappers call invoke with correct args", async () => {
    const stub = {
      name: "demo", rootPath: "/p", workspaces: { branchFrom: "origin/main", filesToCopy: [] },
      remote: "origin", previewUrl: "", scripts: { setup: "", run: "", archive: "" }, preferences: {},
    };
    vi.mocked(invoke).mockResolvedValueOnce(stub as never);
    await projectSettingsGet("p1");
    expect(invoke).toHaveBeenCalledWith("project_settings_get", { projectId: "p1" });

    vi.mocked(invoke).mockResolvedValueOnce(stub as never);
    await projectSettingsUpdate("p1", { remote: "upstream" });
    expect(invoke).toHaveBeenCalledWith("project_settings_update", { projectId: "p1", patch: { remote: "upstream" } });

    vi.mocked(invoke).mockResolvedValueOnce({ path: "/p/maverick.json" } as never);
    await projectSettingsOpenFile("p1");
    expect(invoke).toHaveBeenCalledWith("project_settings_open_file", { projectId: "p1" });
  });
});
