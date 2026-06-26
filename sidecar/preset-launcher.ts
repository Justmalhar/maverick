import { basename } from "path";
import { ConfigLoader } from "./config-loader";
import { WorktreeManager, defaultWorktreeRoot } from "./worktree-manager";
import { slugify } from "./name-generator";
import type { SQLiteStore } from "./sqlite-store";
import type { PresetNode, WorkspacePreset } from "./types";

interface ListParams {
  projectPath?: string;
  projectId?: string;
}

interface LaunchParams {
  preset: WorkspacePreset;
  projectPath: string;
  baseBranch?: string;
  // Resolved by the RPC handler from projectPath; needed to persist the workspace.
  projectId?: string;
}

interface SaveParams {
  workspaceId: string;
  name: string;
  layout: PresetNode;
  description?: string;
  baseBranch?: string;
  projectId?: string;
}

export interface LaunchResult {
  workspaceId: string;
  worktreePath: string;
  /** The actual branch the worktree was created on (`<preset>-<ts>`). */
  branch: string;
  /**
   * The preset layout with each terminal's cwd resolved to the worktree. The
   * frontend builds its SplitGrid from this and spawns each terminal via the
   * Rust ConPTY path — the sidecar no longer pre-spawns PTYs.
   */
  layout: PresetNode;
}

export interface PresetLauncherOptions {
  loader?: ConfigLoader;
  worktree?: WorktreeManager;
  store?: SQLiteStore;
}

export class PresetLauncher {
  private loader: ConfigLoader;
  private worktree: WorktreeManager;
  private store?: SQLiteStore;

  constructor(opts: PresetLauncherOptions = {}) {
    this.loader = opts.loader ?? new ConfigLoader();
    this.worktree = opts.worktree ?? new WorktreeManager();
    this.store = opts.store;
  }

  list(params: ListParams): WorkspacePreset[] {
    const fromConfig = this.configPresets(params.projectPath);
    const fromDb = params.projectId ? this.store?.presetList(params.projectId) ?? [] : [];
    // DB-saved presets (most recent) lead, config presets follow.
    return [...fromDb, ...fromConfig];
  }

  private configPresets(projectPath?: string): WorkspacePreset[] {
    if (!projectPath) return [];
    try {
      const config = this.loader.load(projectPath);
      return config.presets ?? [];
    } catch {
      return [];
    }
  }

  async launch(params: LaunchParams): Promise<LaunchResult> {
    const presetBranch = `${params.preset.name}-${Date.now()}`;
    // Resolve a real base ref (ends in HEAD) instead of hardcoding "main", which
    // hard-fails on master-only / origin-only repos.
    const baseBranch = await this.worktree.resolveBaseBranch(params.projectPath, [
      params.preset.baseBranch,
      params.baseBranch,
      "origin/main",
      "main",
      "master",
    ]);
    const { workspaceId, worktreePath } = await this.worktree.create({
      projectPath: params.projectPath,
      branch: presetBranch,
      baseBranch,
      base: defaultWorktreeRoot(basename(params.projectPath)),
      dirName: slugify(presetBranch),
    });
    // Persist the workspace row so it survives a restart and workspace.destroy can
    // clean up its worktree + PTYs — previously it lived only in the frontend's
    // in-memory store, leaking the on-disk worktree forever on close.
    if (this.store && params.projectId) {
      this.store.workspaceCreate({
        id: workspaceId,
        projectId: params.projectId,
        branch: presetBranch,
        agentBackend: "preset",
        worktreePath,
        title: params.preset.name,
      });
    }
    // Return the layout with cwds resolved — the frontend spawns the terminals
    // via Rust ConPTY. No sidecar pre-spawning (which produced undriveable,
    // headless pipe-PTYs the frontend could never display or kill).
    const layout = this.resolveLayout(params.preset.layout, worktreePath);
    return { workspaceId, worktreePath, branch: presetBranch, layout };
  }

  /** Persist the layout as a named preset. Returns the stored preset. */
  saveCurrent(params: SaveParams): WorkspacePreset {
    if (this.store) {
      return this.store.presetSave({
        name: params.name,
        layout: params.layout,
        description: params.description,
        baseBranch: params.baseBranch,
        projectId: params.projectId,
        workspaceId: params.workspaceId,
      });
    }
    // No store wired (e.g. unit harness) — return the preset without persistence.
    return {
      name: params.name,
      description: params.description,
      baseBranch: params.baseBranch,
      layout: params.layout,
    };
  }

  /** Pure pre-order map: expand each terminal's `{{workspace_root}}` cwd to the
   *  worktree path, leaving the tree shape (splits, browser nodes) intact. */
  private resolveLayout(node: PresetNode, worktreePath: string): PresetNode {
    if (node.type === "terminal") {
      return { ...node, cwd: this.resolveCwd(node.cwd, worktreePath) };
    }
    if (node.type === "browser") {
      return node;
    }
    if ("top" in node) {
      return {
        ...node,
        top: this.resolveLayout(node.top, worktreePath),
        bottom: this.resolveLayout(node.bottom, worktreePath),
      };
    }
    return {
      ...node,
      left: this.resolveLayout(node.left, worktreePath),
      right: this.resolveLayout(node.right, worktreePath),
    };
  }

  private resolveCwd(cwd: string, worktreePath: string): string {
    return cwd.replace("{{workspace_root}}", worktreePath);
  }
}
