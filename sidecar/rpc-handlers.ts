import { z } from "zod";
import { watch } from "fs";
import { join } from "path";
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
import { ProjectSettingsStore } from "./project-settings-store";
import { Caffeinate } from "./caffeinate";
import { InstructionsResolver } from "./instructions-resolver";
import { stdoutNotifier } from "./deps";
import type { Notifier } from "./types";

const RoleSchema = z.enum(["user", "assistant", "tool"]);
const StringParam = z.object({}).passthrough();

// Rust forwards omitted optional command args as JSON `null` (serde serializes
// Option::None as null), but z.optional() only accepts `undefined`. Use this for
// any field fed by a Rust `Option<T>` so `null` is accepted and normalized away.
function nullishOptional<T extends z.ZodTypeAny>(schema: T) {
  return schema.nullish().transform((v) => (v == null ? undefined : v));
}

const Schemas = {
  projectAdd: z.object({ path: z.string(), name: nullishOptional(z.string()) }),
  projectSettingsGet: z.object({ projectId: z.string() }),
  projectSettingsUpdate: z.object({
    projectId: z.string(),
    patch: z.record(z.string(), z.unknown()),
  }),
  projectSettingsOpenFile: z.object({ projectId: z.string() }),
  workspaceCreate: z.object({
    projectId: z.string(),
    projectPath: z.string(),
    branch: z.string(),
    backend: z.string(),
    baseBranch: nullishOptional(z.string()),
  }),
  workspaceDestroy: z.object({ workspaceId: z.string() }),
  workspaceList: z.object({ projectId: nullishOptional(z.string()) }),
  ptySpawn: z.object({
    workspaceId: z.string(),
    command: z.string(),
    args: z.array(z.string()).default([]),
    cwd: nullishOptional(z.string()),
    env: nullishOptional(z.record(z.string(), z.string())),
  }),
  ptyWrite: z.object({ ptyId: z.string(), data: z.string() }),
  ptyResize: z.object({ ptyId: z.string(), cols: z.number(), rows: z.number() }),
  ptyKill: z.object({ ptyId: z.string() }),
  configLoad: z.object({ projectPath: z.string() }),
  messagesList: z.object({
    sessionId: z.string(),
    limit: nullishOptional(z.number()),
    offset: nullishOptional(z.number()),
  }),
  messageAppend: z.object({
    sessionId: z.string(),
    role: RoleSchema,
    content: z.string(),
    toolCallsJson: nullishOptional(z.string()),
  }),
  skillsList: z.object({ projectPath: z.string() }),
  skillsRun: z.object({
    projectPath: z.string(),
    skillName: z.string(),
    vars: z.record(z.string(), z.string()).default({}),
  }),
  diffGet: z.object({ worktreePath: z.string(), filePath: nullishOptional(z.string()) }),
  diffStageHunk: z.object({ worktreePath: z.string(), patch: z.string() }),
  diffUnstageHunk: z.object({ worktreePath: z.string(), patch: z.string() }),
  gitLog: z.object({ worktreePath: z.string(), limit: nullishOptional(z.number()) }),
  gitStashList: z.object({ worktreePath: z.string() }),
  gitCommit: z.object({
    worktreePath: z.string(),
    message: z.string(),
    files: nullishOptional(z.array(z.string())),
  }),
  gitBranches: z.object({ projectPath: z.string() }),
  gitDiffStat: z.object({ worktreePath: z.string() }),
  fileTree: z.object({ worktreePath: z.string(), maxDepth: nullishOptional(z.number()) }),
  kanbanList: z.object({ projectId: z.string() }),
  kanbanUpsert: StringParam,
  presetList: z.object({ projectPath: nullishOptional(z.string()) }),
  presetLaunch: z.object({
    preset: z.record(z.string(), z.unknown()),
    projectPath: z.string(),
    branch: nullishOptional(z.string()),
  }),
  presetSaveCurrent: z.object({
    workspaceId: z.string(),
    name: z.string(),
    layout: z.record(z.string(), z.unknown()),
    description: nullishOptional(z.string()),
  }),
  mcpStart: z.object({ name: z.string(), projectPath: nullishOptional(z.string()) }),
  mcpStop: z.object({ name: z.string() }),
  contextUsage: z.object({ sessionId: z.string() }),
  contextRecord: z.object({
    sessionId: z.string(),
    tokensUsed: z.number().int().nonnegative(),
    costEstimate: z.number().nonnegative(),
  }),
  attachmentCreate: z.object({ worktreePath: z.string(), text: z.string() }),
  automationRun: z.object({
    automationName: z.string(),
    projectPath: z.string(),
    worktreePath: z.string(),
    vars: nullishOptional(z.record(z.string(), z.string())),
  }),
  notifySend: z.object({
    title: z.string(),
    body: z.string(),
    workspaceId: nullishOptional(z.string()),
    type: nullishOptional(z.string()),
  }),
  notifyList: z.object({
    limit: nullishOptional(z.number().int().positive()),
    unreadOnly: nullishOptional(z.boolean()),
  }),
  notifyMarkRead: z.object({ id: z.string() }),
  instructionsResolve: z.object({ worktreePath: z.string() }),
  prCreate: z.object({
    worktreePath: z.string(),
    title: nullishOptional(z.string()),
    body: nullishOptional(z.string()),
    base: nullishOptional(z.string()),
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
  projectSettings?: ProjectSettingsStore;
  caffeinate?: Caffeinate;
  instructions?: InstructionsResolver;
  notifier?: Notifier;
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
  readonly projectSettings: ProjectSettingsStore;
  readonly caffeinate: Caffeinate;
  readonly instructions: InstructionsResolver;
  readonly notifier: Notifier;

  private watchedProjects = new Set<string>();

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
    this.notifications =
      opts.notifications ?? new NotificationService({ store: this.store, notifier: opts.notifier });
    this.context = opts.context ?? new ContextTracker(this.store);
    this.attachments = opts.attachments ?? new AttachmentStore();
    this.fileTree = opts.fileTree ?? new FileTree();
    this.projectSettings = opts.projectSettings ?? new ProjectSettingsStore();
    this.caffeinate = opts.caffeinate ?? new Caffeinate();
    this.instructions = opts.instructions ?? new InstructionsResolver();
    this.notifier = opts.notifier ?? stdoutNotifier;
  }

  private emitProjectSettingsChanged(projectId: string, settings: unknown): void {
    this.notifier.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "project.settings.changed",
        params: { projectId, settings },
      })
    );
  }

  private ensureSettingsWatch(projectId: string, projectPath: string): void {
    if (this.watchedProjects.has(projectId)) return;
    this.watchedProjects.add(projectId);
    const filePath = join(projectPath, "maverick.json");
    const emit = (): void => {
      try {
        const settings = this.projectSettings.read(projectPath);
        this.emitProjectSettingsChanged(projectId, settings);
      } catch {
        /* file may be mid-write */
      }
    };
    try {
      watch(filePath, { persistent: false }, emit);
    } catch {
      try {
        watch(projectPath, { persistent: false }, (_event, name) => {
          if (name === "maverick.json") emit();
        });
      } catch {
        this.watchedProjects.delete(projectId);
      }
    }
  }

  async dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "project.add": {
        const p = Schemas.projectAdd.parse(params);
        return this.store.projectAdd(p);
      }
      case "project.list":
        return this.store.projectList();
      case "project.settings.get": {
        const p = Schemas.projectSettingsGet.parse(params);
        const project = this.store.projectGet(p.projectId);
        if (!project) throw new Error(`project ${p.projectId} not found`);
        const settings = this.projectSettings.read(project.path);
        this.ensureSettingsWatch(p.projectId, project.path);
        return settings;
      }
      case "project.settings.update": {
        const p = Schemas.projectSettingsUpdate.parse(params);
        const project = this.store.projectGet(p.projectId);
        if (!project) throw new Error(`project ${p.projectId} not found`);
        const saved = this.projectSettings.write(project.path, p.patch as never);
        this.emitProjectSettingsChanged(p.projectId, saved);
        return saved;
      }
      case "project.settings.openFile": {
        const p = Schemas.projectSettingsOpenFile.parse(params);
        const project = this.store.projectGet(p.projectId);
        if (!project) throw new Error(`project ${p.projectId} not found`);
        return { path: `${project.path}/maverick.json` };
      }
      case "workspace.create": {
        const p = Schemas.workspaceCreate.parse(params);
        const project = this.store.projectGet(p.projectId);
        const settings = project ? this.projectSettings.read(project.path) : null;
        const { workspaceId, worktreePath } = await this.worktree.create({
          projectPath: p.projectPath,
          branch: p.branch,
          baseBranch: p.baseBranch,
          filesToCopy: settings?.workspaces.filesToCopy,
        });
        const ws = this.store.workspaceCreate({
          id: workspaceId,
          projectId: p.projectId,
          branch: p.branch,
          agentBackend: p.backend,
          worktreePath,
        });
        if (settings && settings.scripts.setup.trim() !== "") {
          try {
            await this.process.spawnOnce({
              cwd: worktreePath,
              command: "/bin/sh",
              args: ["-c", settings.scripts.setup],
            });
          } catch (err) {
            console.error(`[workspace.create] scripts.setup failed:`, err);
          }
        }
        return ws;
      }
      case "workspace.destroy": {
        const p = Schemas.workspaceDestroy.parse(params);
        const ws = this.store.workspaceGet(p.workspaceId);
        if (ws) {
          const project = this.store.projectGet(ws.projectId);
          if (project) {
            const settings = this.projectSettings.read(project.path);
            if (settings.scripts.archive.trim() !== "") {
              const archive = this.process
                .spawnOnce({
                  cwd: ws.worktreePath,
                  command: "/bin/sh",
                  args: ["-c", settings.scripts.archive],
                })
                .catch((err) => {
                  console.error(`[workspace.destroy] archive failed:`, err);
                  return { code: -1 };
                });
              const timeout = new Promise<{ code: number }>((resolve) =>
                setTimeout(() => resolve({ code: -2 }), 30_000)
              );
              await Promise.race([archive, timeout]);
            }
          }
        }
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
        if (!p.cwd) {
          const ws = this.store.workspaceGet(p.workspaceId);
          if (ws) p.cwd = ws.worktreePath;
        }
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
      case "git.branches": {
        const p = Schemas.gitBranches.parse(params);
        return this.git.branches({ projectPath: p.projectPath });
      }
      case "git.diffStat": {
        const p = Schemas.gitDiffStat.parse(params);
        return this.git.diffStat({ worktreePath: p.worktreePath });
      }
      case "pr.create": {
        const p = Schemas.prCreate.parse(params);
        return this.git.prCreate(p);
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
      case "context.record": {
        const p = Schemas.contextRecord.parse(params);
        return this.context.record(p.sessionId, p.tokensUsed, p.costEstimate);
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
      case "notify.list": {
        const p = Schemas.notifyList.parse(params);
        return this.notifications.list(p);
      }
      case "notify.markRead": {
        const p = Schemas.notifyMarkRead.parse(params);
        return this.notifications.markRead(p);
      }
      case "notify.markAllRead": {
        return this.notifications.markAllRead();
      }
      case "notify.unreadCount": {
        return { count: this.notifications.unreadCount() };
      }
      case "caffeinate.start": {
        const r = this.caffeinate.start();
        return { ...r, active: this.caffeinate.active() };
      }
      case "caffeinate.stop": {
        const r = this.caffeinate.stop();
        return { ...r, active: this.caffeinate.active() };
      }
      case "caffeinate.status": {
        return { active: this.caffeinate.active() };
      }
      case "instructions.resolve": {
        const p = Schemas.instructionsResolve.parse(params);
        return this.instructions.resolve(p);
      }
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }
}
