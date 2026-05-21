import { ConfigLoader } from "./config-loader";
import { WorktreeManager } from "./worktree-manager";
import { ProcessManager } from "./process-manager";
import type { PresetNode, WorkspacePreset } from "./types";

interface ListParams {
  projectPath?: string;
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
}

export interface PresetLauncherOptions {
  loader?: ConfigLoader;
  worktree?: WorktreeManager;
  process?: ProcessManager;
}

export class PresetLauncher {
  private loader: ConfigLoader;
  private worktree: WorktreeManager;
  private process: ProcessManager;

  constructor(opts: PresetLauncherOptions = {}) {
    this.loader = opts.loader ?? new ConfigLoader();
    this.worktree = opts.worktree ?? new WorktreeManager();
    this.process = opts.process ?? new ProcessManager();
  }

  list(params: ListParams): WorkspacePreset[] {
    if (!params.projectPath) return [];
    try {
      const config = this.loader.load(params.projectPath);
      return config.presets ?? [];
    } catch {
      return [];
    }
  }

  async launch(params: LaunchParams): Promise<{ workspaceId: string; worktreePath: string; ptyIds: string[] }> {
    const branch = params.preset.baseBranch ?? params.baseBranch ?? "main";
    const { workspaceId, worktreePath } = await this.worktree.create({
      projectPath: params.projectPath,
      branch: `${params.preset.name}-${Date.now()}`,
      baseBranch: branch,
    });
    const ptyIds: string[] = [];
    this.traverse(params.preset.layout, workspaceId, worktreePath, ptyIds);
    return { workspaceId, worktreePath, ptyIds };
  }

  saveCurrent(params: SaveParams): WorkspacePreset {
    return {
      name: params.name,
      description: params.description,
      layout: params.layout,
    };
  }

  private traverse(node: PresetNode, workspaceId: string, worktreePath: string, ptyIds: string[]): void {
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
    if (node.type === "browser") return;
    if ("top" in node) {
      this.traverse(node.top, workspaceId, worktreePath, ptyIds);
      this.traverse(node.bottom, workspaceId, worktreePath, ptyIds);
    } else {
      this.traverse(node.left, workspaceId, worktreePath, ptyIds);
      this.traverse(node.right, workspaceId, worktreePath, ptyIds);
    }
  }

  private resolveCwd(cwd: string, worktreePath: string): string {
    return cwd.replace("{{workspace_root}}", worktreePath);
  }
}
