import { z } from "zod";
import { watch } from "fs";
import { basename, join } from "path";
import { ProcessManager } from "./process-manager";
import { WorktreeManager, defaultWorktreeRoot } from "./worktree-manager";
import { generateWorkspaceName, titleize, branchToDirSlug } from "./name-generator";
import { CommitMessageGenerator } from "./commit-message";
import { BranchNameGenerator } from "./branch-name-generator";
import { SQLiteStore } from "./sqlite-store";
import { ConfigLoader } from "./config-loader";
import { SkillsEngine } from "./skills-engine";
import { SkillsStore } from "./skills-store";
import { DiffReader } from "./diff-reader";
import { GitModule } from "./git-module";
import { GitCredentials } from "./git-credentials";
import { ChecksModule } from "./checks-module";
import { PresetLauncher } from "./preset-launcher";
import { KanbanStore } from "./kanban-store";
import { MCPManager } from "./mcp-manager";
import { NotificationService } from "./notification-service";
import { ContextTracker } from "./context-tracker";
import { UsageTracker } from "./usage-tracker";
import { AttachmentStore } from "./attachment-store";
import { FileTree } from "./file-tree";
import { FsWatcher } from "./fs-watcher";
import { FileSearch } from "./file-search";
import { FileReader } from "./file-reader";
import { FileWriter } from "./file-writer";
import { ProjectSettingsStore } from "./project-settings-store";
import { Caffeinate } from "./caffeinate";
import { InstructionsResolver } from "./instructions-resolver";
import { stdoutNotifier, shellCommandArgs } from "./deps";
import type { MaverickConfig, Notifier } from "./types";

const RoleSchema = z.enum(["user", "assistant", "tool"]);
const CredentialProviderSchema = z.enum(["github", "bitbucket", "gitlab"]);
const StringParam = z.object({}).passthrough();

// Rust forwards omitted optional command args as JSON `null` (serde serializes
// Option::None as null), but z.optional() only accepts `undefined`. Use this for
// any field fed by a Rust `Option<T>` so `null` is accepted and normalized away.
function nullishOptional<T extends z.ZodTypeAny>(schema: T) {
  return schema.nullish().transform((v) => (v == null ? undefined : v));
}

const Schemas = {
  projectAdd: z.object({ path: z.string(), name: nullishOptional(z.string()) }),
  projectDestroy: z.object({ projectId: z.string() }),
  projectSettingsGet: z.object({ projectId: z.string() }),
  projectSettingsUpdate: z.object({
    projectId: z.string(),
    patch: z.record(z.string(), z.unknown()),
  }),
  projectSettingsOpenFile: z.object({ projectId: z.string() }),
  workspaceCreate: z.object({
    projectId: z.string(),
    projectPath: z.string(),
    branch: nullishOptional(z.string()),
    backend: z.string(),
    baseBranch: nullishOptional(z.string()),
  }),
  workspaceDestroy: z.object({ workspaceId: z.string() }),
  workspaceList: z.object({ projectId: nullishOptional(z.string()) }),
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
    workspaceId: nullishOptional(z.string()),
    projectPath: nullishOptional(z.string()),
    skillName: z.string(),
    vars: z.record(z.string(), z.string()).default({}),
  }),
  skillsCreateGlobal: z.object({
    name: z.string(),
    description: z.string(),
    prompt: nullishOptional(z.string()),
    backend: nullishOptional(z.string()),
    overwrite: nullishOptional(z.boolean()),
  }),
  diffGet: z.object({
    worktreePath: z.string(),
    filePath: nullishOptional(z.string()),
    staged: nullishOptional(z.boolean()),
  }),
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
  gitBranchList: z.object({ worktreePath: z.string() }),
  gitCheckout: z.object({ worktreePath: z.string(), branch: z.string() }),
  gitBlame: z.object({ worktreePath: z.string(), filePath: z.string() }),
  gitCherryPick: z.object({ worktreePath: z.string(), sha: z.string() }),
  gitStashIndex: z.object({ worktreePath: z.string(), index: z.number().int().nonnegative() }),
  gitConflicts: z.object({ worktreePath: z.string() }),
  gitResolveConflict: z.object({
    worktreePath: z.string(),
    filePath: z.string(),
    hunkIndex: z.number().int().nonnegative(),
    resolution: z.enum(["ours", "theirs", "both"]),
  }),
  gitFetch: z.object({ worktreePath: z.string(), remote: nullishOptional(z.string()) }),
  gitPull: z.object({ worktreePath: z.string() }),
  gitPush: z.object({
    worktreePath: z.string(),
    remote: nullishOptional(z.string()),
    branch: nullishOptional(z.string()),
  }),
  fileTree: z.object({ worktreePath: z.string(), maxDepth: nullishOptional(z.number()) }),
  fileRead: z.object({ filePath: z.string() }),
  fileWrite: z.object({
    filePath: z.string(),
    content: z.string(),
    expectedMtime: nullishOptional(z.number()),
    encoding: nullishOptional(z.enum(["utf8", "utf8-bom", "utf16le", "utf16be"])),
  }),
  fileReadAtRef: z.object({ worktreePath: z.string(), filePath: z.string(), ref: z.string() }),
  gitDiscardFile: z.object({ worktreePath: z.string(), filePath: z.string() }),
  fileSearch: z.object({
    worktreePath: z.string(),
    query: z.string(),
    limit: nullishOptional(z.number().int().positive()),
  }),
  fsWatchStart: z.object({
    root: z.string(),
    dirs: nullishOptional(z.array(z.string())),
  }),
  fsWatchDirs: z.object({ dirs: z.array(z.string()).default([]) }),
  kanbanList: z.object({ projectId: z.string() }),
  kanbanUpsert: z.object({
    id: nullishOptional(z.string()),
    projectId: z.string().min(1),
    title: z.string().min(1),
    description: nullishOptional(z.string()),
    status: nullishOptional(z.enum(["todo", "in_progress", "review", "done"])),
    columnOrder: nullishOptional(z.number()),
    workspaceId: nullishOptional(z.string()),
    labels: nullishOptional(z.array(z.string())),
    dueDate: nullishOptional(z.number()),
    createdAt: nullishOptional(z.number()),
    agentBackend: nullishOptional(z.string()),
    branch: nullishOptional(z.string()),
    attachments: nullishOptional(
      z.array(
        z.object({
          name: z.string(),
          content: z.string(),
          encoding: z.enum(["utf8", "base64"]),
          size: z.number(),
        })
      )
    ),
  }),
  kanbanDelete: z.object({ id: z.string().min(1) }),
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
    baseBranch: nullishOptional(z.string()),
  }),
  mcpStart: z.object({
    name: z.string(),
    workspaceId: nullishOptional(z.string()),
    projectPath: nullishOptional(z.string()),
  }),
  mcpStop: z.object({ name: z.string() }),
  mcpLogs: z.object({ name: z.string(), sinceOffset: nullishOptional(z.number().int().nonnegative()) }),
  mcpAdd: z.object({
    name: z.string().trim().min(1, "MCP server name must not be empty"),
    command: z.string().trim().min(1, "MCP server command must not be empty"),
    args: z.array(z.string()).default([]),
    env: nullishOptional(z.record(z.string(), z.string())),
    workspaceId: nullishOptional(z.string()),
    projectPath: nullishOptional(z.string()),
  }),
  configSave: z.object({
    projectPath: z.string(),
    patch: z.record(z.string(), z.unknown()),
  }),
  contextUsage: z.object({ sessionId: z.string() }),
  contextRecord: z.object({
    sessionId: z.string(),
    tokensUsed: z.number().int().nonnegative(),
    costEstimate: z.number().nonnegative(),
  }),
  attachmentCreate: z.object({ worktreePath: z.string(), text: z.string() }),
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
    remote: nullishOptional(z.string()),
  }),
  checksGet: z.object({ worktreePath: z.string() }),
  gitRemoteInfo: z.object({
    worktreePath: z.string(),
    remote: nullishOptional(z.string()),
  }),
  aiCommitMessage: z.object({ worktreePath: z.string() }),
  aiBranchName: z.object({
    prompt: z.string(),
    cwd: nullishOptional(z.string()),
    instructions: nullishOptional(z.string()),
  }),
  aiBranchNameFromDiff: z.object({
    cwd: z.string(),
    instructions: nullishOptional(z.string()),
  }),
  gitRenameBranch: z.object({ worktreePath: z.string(), newBranch: z.string() }),
  credentialProvider: z.object({ provider: CredentialProviderSchema }),
  credentialConnect: z.object({
    provider: CredentialProviderSchema,
    username: z.string(),
    password: z.string(),
  }),
  credentialDisconnect: z.object({
    provider: CredentialProviderSchema,
    username: nullishOptional(z.string()),
  }),
};

export interface RpcHandlersOptions {
  store?: SQLiteStore;
  process?: ProcessManager;
  worktree?: WorktreeManager;
  config?: ConfigLoader;
  skills?: SkillsEngine;
  skillsStore?: SkillsStore;
  diff?: DiffReader;
  git?: GitModule;
  checks?: ChecksModule;
  presets?: PresetLauncher;
  kanban?: KanbanStore;
  mcp?: MCPManager;
  notifications?: NotificationService;
  context?: ContextTracker;
  usage?: UsageTracker;
  attachments?: AttachmentStore;
  fileTree?: FileTree;
  fsWatcher?: FsWatcher;
  fileSearch?: FileSearch;
  fileReader?: FileReader;
  fileWriter?: FileWriter;
  projectSettings?: ProjectSettingsStore;
  caffeinate?: Caffeinate;
  instructions?: InstructionsResolver;
  commitMessage?: CommitMessageGenerator;
  branchName?: BranchNameGenerator;
  credentials?: GitCredentials;
  notifier?: Notifier;
}

export class RpcHandlers {
  readonly store: SQLiteStore;
  readonly process: ProcessManager;
  readonly worktree: WorktreeManager;
  readonly config: ConfigLoader;
  readonly skills: SkillsEngine;
  readonly skillsStore: SkillsStore;
  readonly diff: DiffReader;
  readonly git: GitModule;
  readonly checks: ChecksModule;
  readonly presets: PresetLauncher;
  readonly kanban: KanbanStore;
  readonly mcp: MCPManager;
  readonly notifications: NotificationService;
  readonly context: ContextTracker;
  readonly usage: UsageTracker;
  readonly attachments: AttachmentStore;
  readonly fileTree: FileTree;
  readonly fsWatcher: FsWatcher;
  readonly fileSearch: FileSearch;
  readonly fileReader: FileReader;
  readonly fileWriter: FileWriter;
  readonly projectSettings: ProjectSettingsStore;
  readonly caffeinate: Caffeinate;
  readonly instructions: InstructionsResolver;
  readonly commitMessage: CommitMessageGenerator;
  readonly branchName: BranchNameGenerator;
  readonly credentials: GitCredentials;
  readonly notifier: Notifier;

  private watchedProjects = new Set<string>();

  constructor(opts: RpcHandlersOptions = {}) {
    this.store = opts.store ?? new SQLiteStore();
    this.process = opts.process ?? new ProcessManager();
    this.worktree = opts.worktree ?? new WorktreeManager();
    this.config = opts.config ?? new ConfigLoader();
    this.skills = opts.skills ?? new SkillsEngine({ loader: this.config });
    this.skillsStore = opts.skillsStore ?? new SkillsStore();
    this.diff = opts.diff ?? new DiffReader();
    this.git = opts.git ?? new GitModule();
    this.checks = opts.checks ?? new ChecksModule();
    this.presets =
      opts.presets ??
      new PresetLauncher({
        loader: this.config,
        worktree: this.worktree,
        process: this.process,
        store: this.store,
      });
    this.kanban = opts.kanban ?? new KanbanStore(this.store);
    this.mcp = opts.mcp ?? new MCPManager({ loader: this.config });
    this.notifications =
      opts.notifications ?? new NotificationService({ store: this.store, notifier: opts.notifier });
    this.context = opts.context ?? new ContextTracker(this.store);
    this.usage = opts.usage ?? new UsageTracker();
    this.attachments = opts.attachments ?? new AttachmentStore();
    this.fileTree = opts.fileTree ?? new FileTree();
    this.notifier = opts.notifier ?? stdoutNotifier;
    this.fsWatcher = opts.fsWatcher ?? new FsWatcher({ notifier: this.notifier });
    this.fileSearch = opts.fileSearch ?? new FileSearch();
    this.fileReader = opts.fileReader ?? new FileReader();
    this.fileWriter = opts.fileWriter ?? new FileWriter();
    this.projectSettings = opts.projectSettings ?? new ProjectSettingsStore();
    this.caffeinate = opts.caffeinate ?? new Caffeinate();
    this.instructions = opts.instructions ?? new InstructionsResolver();
    this.commitMessage = opts.commitMessage ?? new CommitMessageGenerator();
    this.branchName = opts.branchName ?? new BranchNameGenerator();
    this.credentials = opts.credentials ?? new GitCredentials();
  }

  // Frontend panels address a workspace by id; skills/automation/mcp need the
  // on-disk project root and worktree path. Resolve them from the store so the
  // three layers (React -> Rust -> sidecar) agree on a single contract.
  private requireWorkspacePaths(workspaceId: string | undefined): {
    projectPath: string;
    worktreePath: string;
  } {
    if (!workspaceId) throw new Error("workspaceId or projectPath is required");
    const ws = this.store.workspaceGet(workspaceId);
    if (!ws) throw new Error(`workspace ${workspaceId} not found`);
    const project = this.store.projectGet(ws.projectId);
    if (!project) throw new Error(`project ${ws.projectId} not found`);
    return { projectPath: project.path, worktreePath: ws.worktreePath };
  }

  private async teardownWorkspace(workspaceId: string): Promise<void> {
    const ws = this.store.workspaceGet(workspaceId);
    if (!ws) return;
    // Preset/terminal PTYs are Rust-owned and reaped by the frontend's
    // killWorkspaceLeaves on removeWorkspace — the sidecar spawns none.
    const project = this.store.projectGet(ws.projectId);
    if (project) {
      const settings = this.projectSettings.read(project.path);
      if (settings.scripts.archive.trim() !== "") {
            // cmd.exe /c on Windows, /bin/sh -c on POSIX — /bin/sh doesn't exist on Windows.
        const [archiveCmd, ...archiveArgs] = shellCommandArgs(settings.scripts.archive);
        const { proc, exited } = this.process.spawnOnceHandle({
          cwd: ws.worktreePath,
          command: archiveCmd,
          args: archiveArgs,
        });
        const archive = exited
          .then((code) => ({ code }))
          .catch((err) => {
            console.error(`[teardownWorkspace] archive failed:`, err);
            return { code: -1 };
          });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<{ code: number }>((resolve) => {
          timer = setTimeout(() => {
            try {
              proc.kill();
            } catch {
              /* already exited */
            }
            resolve({ code: -2 });
          }, 30_000);
        });
        await Promise.race([archive, timeout]);
        if (timer) clearTimeout(timer);
      }
    }
    // Remove the worktree (with a prune fallback) BEFORE deleting the DB row:
    // if removal throws, the row survives so the worktree stays recoverable
    // rather than becoming an orphaned, unreferenced directory.
    await this.worktree.destroy({
      worktreePath: ws.worktreePath,
      projectPath: project?.path,
    });
    this.store.workspaceDestroy(workspaceId);
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

  // Drives MCP backoff-gated auto-restarts. The server loop calls this on a
  // fixed interval; each tick re-spawns any crashed server whose backoff window
  // has elapsed (until the per-server retry cap is hit).
  pollMcpHealth(): void {
    this.mcp.tick();
  }

  async dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "project.add": {
        const p = Schemas.projectAdd.parse(params);
        return this.store.projectAdd(p);
      }
      case "project.list":
        return this.store.projectList();
      case "project.destroy": {
        const p = Schemas.projectDestroy.parse(params);
        const project = this.store.projectGet(p.projectId);
        if (!project) return { ok: true };
        for (const ws of this.store.workspaceList(p.projectId)) {
          await this.teardownWorkspace(ws.id);
        }
        this.store.projectDestroy(p.projectId);
        return { ok: true };
      }
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
        return { path: join(project.path, "maverick.json") };
      }
      case "workspace.create": {
        const p = Schemas.workspaceCreate.parse(params);
        const project = this.store.projectGet(p.projectId);
        const settings = project ? this.projectSettings.read(project.path) : null;
        const projectName = project?.name ?? basename(p.projectPath);

        // Auto-name when the caller doesn't pick a branch; the callsign is
        // unique across local + remote branches so `worktree add -b` can't fail
        // on an existing ref.
        let branch = p.branch?.trim() || "";
        let title: string | undefined;
        if (!branch) {
          let taken: string[] = [];
          try {
            taken = await this.git.allBranchNames({ projectPath: p.projectPath });
          } catch {
            /* not fatal — a bare repo still gets a name */
          }
          branch = generateWorkspaceName(taken);
          title = titleize(branch);
        }

        const baseBranch = await this.worktree.resolveBaseBranch(p.projectPath, [
          p.baseBranch,
          settings?.workspaces.branchFrom,
          "origin/main",
          "main",
          "master",
        ]);

        const { workspaceId, worktreePath } = await this.worktree.create({
          projectPath: p.projectPath,
          branch,
          baseBranch,
          filesToCopy: settings?.workspaces.filesToCopy,
          base: settings?.workspaces.basePath ?? defaultWorktreeRoot(projectName),
          // branchToDirSlug, not slugify: slugify deletes "/" and would flatten
          // "feature/login" → "featurelogin"; we want "feature-login".
          dirName: branchToDirSlug(branch),
        });
        // scripts.setup is intentionally NOT run here: the frontend streams it
        // through the Setup tab PTY so creation returns immediately and the
        // agent terminal is usable while dependencies install.
        return this.store.workspaceCreate({
          id: workspaceId,
          projectId: p.projectId,
          branch,
          agentBackend: p.backend,
          worktreePath,
          title,
        });
      }
      case "workspace.destroy": {
        const p = Schemas.workspaceDestroy.parse(params);
        await this.teardownWorkspace(p.workspaceId);
        return { ok: true };
      }
      case "workspace.list": {
        const p = Schemas.workspaceList.parse(params);
        return this.store.workspaceList(p.projectId);
      }
      case "config.load": {
        const p = Schemas.configLoad.parse(params);
        return this.config.load(p.projectPath);
      }
      case "config.save": {
        const p = Schemas.configSave.parse(params);
        return this.config.save(p.projectPath, p.patch as Partial<MaverickConfig>);
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
        const projectPath = p.projectPath ?? this.requireWorkspacePaths(p.workspaceId).projectPath;
        return this.skills.run({ projectPath, skillName: p.skillName, vars: p.vars });
      }
      case "skills.listGlobal":
        return this.skillsStore.list();
      case "skills.createGlobal": {
        const p = Schemas.skillsCreateGlobal.parse(params);
        const filePath = this.skillsStore.create(p.name, p.description, p.prompt ?? "", p.backend ?? undefined, p.overwrite ?? false);
        return { ok: true, filePath };
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
      case "git.branch_list": {
        const p = Schemas.gitBranchList.parse(params);
        return this.git.branchList({ worktreePath: p.worktreePath });
      }
      case "git.checkout": {
        const p = Schemas.gitCheckout.parse(params);
        return this.git.checkoutBranch(p);
      }
      case "git.blame": {
        const p = Schemas.gitBlame.parse(params);
        return this.git.blame(p);
      }
      case "git.cherry_pick": {
        const p = Schemas.gitCherryPick.parse(params);
        return this.git.cherryPick(p);
      }
      case "git.stash_apply": {
        const p = Schemas.gitStashIndex.parse(params);
        return this.git.stashApply(p);
      }
      case "git.stash_pop": {
        const p = Schemas.gitStashIndex.parse(params);
        return this.git.stashPop(p);
      }
      case "git.stash_drop": {
        const p = Schemas.gitStashIndex.parse(params);
        return this.git.stashDrop(p);
      }
      case "git.conflicts": {
        const p = Schemas.gitConflicts.parse(params);
        return this.git.conflicts({ worktreePath: p.worktreePath });
      }
      case "git.resolve_conflict": {
        const p = Schemas.gitResolveConflict.parse(params);
        return this.git.resolveConflict(p);
      }
      case "git.fetch": {
        const p = Schemas.gitFetch.parse(params);
        return this.git.fetch(p);
      }
      case "git.pull": {
        const p = Schemas.gitPull.parse(params);
        return this.git.pull(p);
      }
      case "git.push": {
        const p = Schemas.gitPush.parse(params);
        return this.git.push(p);
      }
      case "pr.create": {
        const p = Schemas.prCreate.parse(params);
        return this.git.prCreate(p);
      }
      case "checks.get": {
        const p = Schemas.checksGet.parse(params);
        return this.checks.get(p);
      }
      case "git.remote_info": {
        const p = Schemas.gitRemoteInfo.parse(params);
        return this.git.remoteInfo(p);
      }
      case "ai.commit_message": {
        const p = Schemas.aiCommitMessage.parse(params);
        return this.commitMessage.generate(p);
      }
      case "ai.branch_name": {
        const p = Schemas.aiBranchName.parse(params);
        return this.branchName.generate({
          prompt: p.prompt,
          cwd: p.cwd ?? undefined,
          instructions: p.instructions ?? undefined,
        });
      }
      case "ai.branch_name_from_diff": {
        const p = Schemas.aiBranchNameFromDiff.parse(params);
        return this.branchName.generateFromDiff({ cwd: p.cwd, instructions: p.instructions ?? undefined });
      }
      case "git.rename_branch": {
        const p = Schemas.gitRenameBranch.parse(params);
        return this.git.renameBranch(p);
      }
      case "git.credential_status": {
        const p = Schemas.credentialProvider.parse(params);
        return this.credentials.status(p.provider);
      }
      case "git.credential_connect": {
        const p = Schemas.credentialConnect.parse(params);
        return this.credentials.connect(p);
      }
      case "git.credential_disconnect": {
        const p = Schemas.credentialDisconnect.parse(params);
        return this.credentials.disconnect({ provider: p.provider, username: p.username ?? undefined });
      }
      case "file.tree": {
        const p = Schemas.fileTree.parse(params);
        return this.fileTree.tree(p);
      }
      case "file.read": {
        const p = Schemas.fileRead.parse(params);
        return this.fileReader.read(p);
      }
      case "file.write": {
        const p = Schemas.fileWrite.parse(params);
        return this.fileWriter.write({
          filePath: p.filePath,
          content: p.content,
          expectedMtime: p.expectedMtime,
          encoding: p.encoding ?? undefined,
        });
      }
      case "file.readAtRef": {
        const p = Schemas.fileReadAtRef.parse(params);
        return this.git.showAtRef(p);
      }
      case "git.discard_file": {
        const p = Schemas.gitDiscardFile.parse(params);
        return this.git.discardFile(p);
      }
      case "file.search": {
        const p = Schemas.fileSearch.parse(params);
        return this.fileSearch.search({
          worktreePath: p.worktreePath,
          query: p.query,
          limit: p.limit,
        });
      }
      case "fs.watch.start": {
        const p = Schemas.fsWatchStart.parse(params);
        return this.fsWatcher.start({ root: p.root, dirs: p.dirs });
      }
      case "fs.watch.add": {
        const p = Schemas.fsWatchDirs.parse(params);
        return this.fsWatcher.add({ dirs: p.dirs });
      }
      case "fs.watch.remove": {
        const p = Schemas.fsWatchDirs.parse(params);
        return this.fsWatcher.remove({ dirs: p.dirs });
      }
      case "fs.watch.stop": {
        return this.fsWatcher.stop();
      }
      case "kanban.list": {
        const p = Schemas.kanbanList.parse(params);
        return this.kanban.list(p.projectId);
      }
      case "kanban.upsert": {
        const task = Schemas.kanbanUpsert.parse(params.task ?? params);
        return this.kanban.upsert(task);
      }
      case "kanban.delete": {
        const p = Schemas.kanbanDelete.parse(params);
        return this.kanban.delete(p.id);
      }
      case "preset.list": {
        const p = Schemas.presetList.parse(params);
        const projectId = p.projectPath
          ? this.store.projectByPath(p.projectPath)?.id
          : undefined;
        return this.presets.list({ projectPath: p.projectPath, projectId });
      }
      case "preset.launch": {
        const p = Schemas.presetLaunch.parse(params);
        const projectId = this.store.projectByPath(p.projectPath)?.id;
        return this.presets.launch({
          preset: p.preset as never,
          projectPath: p.projectPath,
          baseBranch: p.branch,
          projectId,
        });
      }
      case "preset.save_current": {
        const p = Schemas.presetSaveCurrent.parse(params);
        return this.presets.saveCurrent({
          workspaceId: p.workspaceId,
          name: p.name,
          layout: p.layout as never,
          description: p.description ?? undefined,
          baseBranch: p.baseBranch ?? undefined,
        });
      }
      case "mcp.start": {
        const p = Schemas.mcpStart.parse(params);
        const projectPath = p.projectPath ?? (p.workspaceId ? this.requireWorkspacePaths(p.workspaceId).projectPath : undefined);
        if (projectPath) this.mcp.setProjectPath(projectPath);
        return this.mcp.start(p.name);
      }
      case "mcp.stop": {
        const p = Schemas.mcpStop.parse(params);
        return this.mcp.stop(p.name);
      }
      case "mcp.list":
        return this.mcp.list();
      case "mcp.logs": {
        const p = Schemas.mcpLogs.parse(params);
        return this.mcp.logs(p.name, p.sinceOffset ?? 0);
      }
      case "mcp.add": {
        const p = Schemas.mcpAdd.parse(params);
        const projectPath =
          p.projectPath ?? (p.workspaceId ? this.requireWorkspacePaths(p.workspaceId).projectPath : undefined);
        if (!projectPath) throw new Error("mcp.add requires workspaceId or projectPath");
        const config = this.config.load(projectPath);
        const mcps = (config.mcps ?? []).filter((m) => m.name !== p.name);
        mcps.push({ name: p.name, command: p.command, args: p.args, env: p.env });
        this.config.save(projectPath, { mcps });
        return { ok: true };
      }
      case "context.usage": {
        const p = Schemas.contextUsage.parse(params);
        return this.context.usage(p.sessionId);
      }
      case "context.record": {
        const p = Schemas.contextRecord.parse(params);
        return this.context.record(p.sessionId, p.tokensUsed, p.costEstimate);
      }
      case "usage.summary":
        return this.usage.summary();
      case "attachment.create": {
        const p = Schemas.attachmentCreate.parse(params);
        return this.attachments.create(p);
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
