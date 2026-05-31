import { ConfigLoader } from "./config-loader";
import { WorktreeManager } from "./worktree-manager";
import { ProcessManager } from "./process-manager";
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
  ptyIds: string[];
  /** Browser panes the layout declares — the UI opens a browser pane per entry. */
  browserPanes: Array<{ url?: string }>;
}

export interface PresetLauncherOptions {
  loader?: ConfigLoader;
  worktree?: WorktreeManager;
  process?: ProcessManager;
  store?: SQLiteStore;
}

export class PresetLauncher {
  private loader: ConfigLoader;
  private worktree: WorktreeManager;
  private process: ProcessManager;
  private store?: SQLiteStore;

  constructor(opts: PresetLauncherOptions = {}) {
    this.loader = opts.loader ?? new ConfigLoader();
    this.worktree = opts.worktree ?? new WorktreeManager();
    this.process = opts.process ?? new ProcessManager();
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
    const branch = params.preset.baseBranch ?? params.baseBranch ?? "main";
    const { workspaceId, worktreePath } = await this.worktree.create({
      projectPath: params.projectPath,
      branch: `${params.preset.name}-${Date.now()}`,
      baseBranch: branch,
    });
    const ptyIds: string[] = [];
    const browserPanes: Array<{ url?: string }> = [];
    this.traverse(params.preset.layout, workspaceId, worktreePath, ptyIds, browserPanes);
    return { workspaceId, worktreePath, ptyIds, browserPanes };
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

  private traverse(
    node: PresetNode,
    workspaceId: string,
    worktreePath: string,
    ptyIds: string[],
    browserPanes: Array<{ url?: string }>
  ): void {
    if (node.type === "terminal") {
      const { ptyId } = this.process.spawn({
        workspaceId,
        command: node.agent,
        args: [],
        cwd: this.resolveCwd(node.cwd, worktreePath),
      });
      ptyIds.push(ptyId);
      if (node.startup) {
        void this.process.write({ ptyId, data: node.startup + "\n" });
      }
      return;
    }
    if (node.type === "browser") {
      browserPanes.push({ url: node.url });
      return;
    }
    if ("top" in node) {
      this.traverse(node.top, workspaceId, worktreePath, ptyIds, browserPanes);
      this.traverse(node.bottom, workspaceId, worktreePath, ptyIds, browserPanes);
    } else {
      this.traverse(node.left, workspaceId, worktreePath, ptyIds, browserPanes);
      this.traverse(node.right, workspaceId, worktreePath, ptyIds, browserPanes);
    }
  }

  private resolveCwd(cwd: string, worktreePath: string): string {
    return cwd.replace("{{workspace_root}}", worktreePath);
  }
}
