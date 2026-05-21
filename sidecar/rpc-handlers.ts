import { z } from "zod";
import { ProcessManager } from "./process-manager";
import { WorktreeManager } from "./worktree-manager";
import { SQLiteStore } from "./sqlite-store";
import { ConfigLoader } from "./config-loader";
import { SkillsEngine } from "./skills-engine";
import { DiffReader } from "./diff-reader";
import { GitModule } from "./git-module";
import { PresetLauncher } from "./preset-launcher";
import { KanbanStore } from "./kanban-store";
import { AutomationRunner } from "./automation-runner";
import { MCPManager } from "./mcp-manager";
import { NotificationService } from "./notification-service";
import { ContextTracker } from "./context-tracker";
import { AttachmentStore } from "./attachment-store";
import { FileTree } from "./file-tree";

const RoleSchema = z.enum(["user", "assistant", "tool"]);
const StringParam = z.object({}).passthrough();

const Schemas = {
  projectAdd: z.object({ path: z.string(), name: z.string().optional() }),
  workspaceCreate: z.object({
    projectId: z.string(),
    projectPath: z.string(),
    branch: z.string(),
    backend: z.string(),
    baseBranch: z.string().optional(),
  }),
  workspaceDestroy: z.object({ workspaceId: z.string() }),
  workspaceList: z.object({ projectId: z.string().optional() }),
  ptySpawn: z.object({
    workspaceId: z.string(),
    command: z.string(),
    args: z.array(z.string()).default([]),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
  }),
  ptyWrite: z.object({ ptyId: z.string(), data: z.string() }),
  ptyResize: z.object({ ptyId: z.string(), cols: z.number(), rows: z.number() }),
  ptyKill: z.object({ ptyId: z.string() }),
  configLoad: z.object({ projectPath: z.string() }),
  messagesList: z.object({
    sessionId: z.string(),
    limit: z.number().optional(),
    offset: z.number().optional(),
  }),
  messageAppend: z.object({
    sessionId: z.string(),
    role: RoleSchema,
    content: z.string(),
    toolCallsJson: z.string().optional(),
  }),
  skillsList: z.object({ projectPath: z.string() }),
  skillsRun: z.object({
    projectPath: z.string(),
    skillName: z.string(),
    vars: z.record(z.string(), z.string()).default({}),
  }),
  diffGet: z.object({ worktreePath: z.string(), filePath: z.string().optional() }),
  diffStageHunk: z.object({ worktreePath: z.string(), patch: z.string() }),
  diffUnstageHunk: z.object({ worktreePath: z.string(), patch: z.string() }),
  gitLog: z.object({ worktreePath: z.string(), limit: z.number().optional() }),
  gitStashList: z.object({ worktreePath: z.string() }),
  gitCommit: z.object({
    worktreePath: z.string(),
    message: z.string(),
    files: z.array(z.string()).optional(),
  }),
  fileTree: z.object({ worktreePath: z.string(), maxDepth: z.number().optional() }),
  kanbanList: z.object({ projectId: z.string() }),
  kanbanUpsert: StringParam,
  presetList: z.object({ projectPath: z.string().optional() }),
  presetLaunch: z.object({
    preset: z.record(z.string(), z.unknown()),
    projectPath: z.string(),
    branch: z.string().optional(),
  }),
  presetSaveCurrent: z.object({
    workspaceId: z.string(),
    name: z.string(),
    layout: z.record(z.string(), z.unknown()),
    description: z.string().optional(),
  }),
  mcpStart: z.object({ name: z.string(), projectPath: z.string().optional() }),
  mcpStop: z.object({ name: z.string() }),
  contextUsage: z.object({ sessionId: z.string() }),
  attachmentCreate: z.object({ worktreePath: z.string(), text: z.string() }),
  automationRun: z.object({
    automationName: z.string(),
    projectPath: z.string(),
    worktreePath: z.string(),
    vars: z.record(z.string(), z.string()).optional(),
  }),
  notifySend: z.object({
    title: z.string(),
    body: z.string(),
    workspaceId: z.string().optional(),
  }),
};

export interface RpcHandlersOptions {
  store?: SQLiteStore;
  process?: ProcessManager;
  worktree?: WorktreeManager;
  config?: ConfigLoader;
  skills?: SkillsEngine;
  diff?: DiffReader;
  git?: GitModule;
  presets?: PresetLauncher;
  kanban?: KanbanStore;
  automations?: AutomationRunner;
  mcp?: MCPManager;
  notifications?: NotificationService;
  context?: ContextTracker;
  attachments?: AttachmentStore;
  fileTree?: FileTree;
}

export class RpcHandlers {
  readonly store: SQLiteStore;
  readonly process: ProcessManager;
  readonly worktree: WorktreeManager;
  readonly config: ConfigLoader;
  readonly skills: SkillsEngine;
  readonly diff: DiffReader;
  readonly git: GitModule;
  readonly presets: PresetLauncher;
  readonly kanban: KanbanStore;
  readonly automations: AutomationRunner;
  readonly mcp: MCPManager;
  readonly notifications: NotificationService;
  readonly context: ContextTracker;
  readonly attachments: AttachmentStore;
  readonly fileTree: FileTree;

  constructor(opts: RpcHandlersOptions = {}) {
    this.store = opts.store ?? new SQLiteStore();
    this.process = opts.process ?? new ProcessManager();
    this.worktree = opts.worktree ?? new WorktreeManager();
    this.config = opts.config ?? new ConfigLoader();
    this.skills = opts.skills ?? new SkillsEngine({ loader: this.config });
    this.diff = opts.diff ?? new DiffReader();
    this.git = opts.git ?? new GitModule();
    this.presets =
      opts.presets ?? new PresetLauncher({ loader: this.config, worktree: this.worktree, process: this.process });
    this.kanban = opts.kanban ?? new KanbanStore(this.store);
    this.automations =
      opts.automations ?? new AutomationRunner({ loader: this.config, git: this.git, skills: this.skills });
    this.mcp = opts.mcp ?? new MCPManager({ loader: this.config });
    this.notifications = opts.notifications ?? new NotificationService();
    this.context = opts.context ?? new ContextTracker(this.store);
    this.attachments = opts.attachments ?? new AttachmentStore();
    this.fileTree = opts.fileTree ?? new FileTree();
  }

  async dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "project.add": {
        const p = Schemas.projectAdd.parse(params);
        return this.store.projectAdd(p);
      }
      case "project.list":
        return this.store.projectList();
      case "workspace.create": {
        const p = Schemas.workspaceCreate.parse(params);
        const { workspaceId, worktreePath } = await this.worktree.create({
          projectPath: p.projectPath,
          branch: p.branch,
          baseBranch: p.baseBranch,
        });
        const ws = this.store.workspaceCreate({
          id: workspaceId,
          projectId: p.projectId,
          branch: p.branch,
          agentBackend: p.backend,
          worktreePath,
        });
        return ws;
      }
      case "workspace.destroy": {
        const p = Schemas.workspaceDestroy.parse(params);
        const { worktreePath } = this.store.workspaceDestroy(p.workspaceId);
        await this.worktree.destroy({ worktreePath });
        return { ok: true };
      }
      case "workspace.list": {
        const p = Schemas.workspaceList.parse(params);
        return this.store.workspaceList(p.projectId);
      }
      case "pty.spawn": {
        const p = Schemas.ptySpawn.parse(params);
        return this.process.spawn(p);
      }
      case "pty.write": {
        const p = Schemas.ptyWrite.parse(params);
        return this.process.write(p);
      }
      case "pty.resize": {
        const p = Schemas.ptyResize.parse(params);
        return this.process.resize(p);
      }
      case "pty.kill": {
        const p = Schemas.ptyKill.parse(params);
        return this.process.kill(p);
      }
      case "config.load": {
        const p = Schemas.configLoad.parse(params);
        return this.config.load(p.projectPath);
      }
      case "messages.list": {
        const p = Schemas.messagesList.parse(params);
        return this.store.messagesList(p);
      }
      case "messages.append": {
        const p = Schemas.messageAppend.parse(params);
        return this.store.messageAppend(p);
      }
      case "skills.list": {
        const p = Schemas.skillsList.parse(params);
        return this.skills.list(p.projectPath);
      }
      case "skills.run": {
        const p = Schemas.skillsRun.parse(params);
        return this.skills.run(p);
      }
      case "diff.get": {
        const p = Schemas.diffGet.parse(params);
        return this.diff.get(p);
      }
      case "diff.stage_hunk": {
        const p = Schemas.diffStageHunk.parse(params);
        return this.diff.stageHunk(p);
      }
      case "diff.unstage_hunk": {
        const p = Schemas.diffUnstageHunk.parse(params);
        return this.diff.unstageHunk(p);
      }
      case "git.log": {
        const p = Schemas.gitLog.parse(params);
        return this.git.log(p);
      }
      case "git.stash_list": {
        const p = Schemas.gitStashList.parse(params);
        return this.git.stashList(p);
      }
      case "git.commit": {
        const p = Schemas.gitCommit.parse(params);
        return this.git.commit(p);
      }
      case "file.tree": {
        const p = Schemas.fileTree.parse(params);
        return this.fileTree.tree(p);
      }
      case "kanban.list": {
        const p = Schemas.kanbanList.parse(params);
        return this.kanban.list(p.projectId);
      }
      case "kanban.upsert": {
        const taskInput = (params.task ?? params) as Record<string, unknown>;
        const projectId = String(taskInput.projectId ?? "");
        const title = String(taskInput.title ?? "");
        if (!projectId || !title) throw new Error("kanban.upsert requires projectId and title");
        return this.kanban.upsert({ ...taskInput, projectId, title } as never);
      }
      case "preset.list": {
        const p = Schemas.presetList.parse(params);
        return this.presets.list(p);
      }
      case "preset.launch": {
        const p = Schemas.presetLaunch.parse(params);
        return this.presets.launch({
          preset: p.preset as never,
          projectPath: p.projectPath,
          baseBranch: p.branch,
        });
      }
      case "preset.save_current": {
        const p = Schemas.presetSaveCurrent.parse(params);
        return this.presets.saveCurrent({
          workspaceId: p.workspaceId,
          name: p.name,
          layout: p.layout as never,
          description: p.description,
        });
      }
      case "mcp.start": {
        const p = Schemas.mcpStart.parse(params);
        if (p.projectPath) this.mcp.setProjectPath(p.projectPath);
        return this.mcp.start(p.name);
      }
      case "mcp.stop": {
        const p = Schemas.mcpStop.parse(params);
        return this.mcp.stop(p.name);
      }
      case "mcp.list":
        return this.mcp.list();
      case "context.usage": {
        const p = Schemas.contextUsage.parse(params);
        return this.context.usage(p.sessionId);
      }
      case "attachment.create": {
        const p = Schemas.attachmentCreate.parse(params);
        return this.attachments.create(p);
      }
      case "automation.run": {
        const p = Schemas.automationRun.parse(params);
        return this.automations.run(p);
      }
      case "notify.send": {
        const p = Schemas.notifySend.parse(params);
        return this.notifications.send(p);
      }
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }
}
