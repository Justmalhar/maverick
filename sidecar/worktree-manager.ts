import { existsSync, statSync, mkdirSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { defaultIds, defaultShell } from "./deps";
import type { IdProvider, Shell } from "./types";

interface CreateParams {
  projectPath: string;
  branch: string;
  baseBranch?: string;
  filesToCopy?: string[];
}

interface DestroyParams {
  worktreePath: string;
}

interface ListParams {
  projectPath: string;
}

export interface WorktreeInfo {
  path: string;
  branch?: string;
  head?: string;
}

export interface WorktreeManagerOptions {
  shell?: Shell;
  ids?: IdProvider;
  base?: string;
}

export class WorktreeManager {
  private shell: Shell;
  private ids: IdProvider;
  private base: string;

  constructor(opts: WorktreeManagerOptions = {}) {
    this.shell = opts.shell ?? defaultShell;
    this.ids = opts.ids ?? defaultIds;
    this.base = opts.base ?? ".maverick/worktrees";
  }

  async create(params: CreateParams): Promise<{ workspaceId: string; worktreePath: string }> {
    const workspaceId = this.ids.uuid("ws");
    const worktreePath = `${this.base}/${workspaceId}`;
    const baseBranch = params.baseBranch ?? params.branch;
    await this.shell.run(
      ["git", "worktree", "add", "-b", params.branch, worktreePath, baseBranch],
      params.projectPath
    );
    if (params.filesToCopy && params.filesToCopy.length > 0) {
      for (const rel of params.filesToCopy) {
        const src = join(params.projectPath, rel);
        const dst = join(worktreePath, rel);
        try {
          if (!existsSync(src)) continue;
          const stat = statSync(src);
          if (!stat.isFile()) continue;
          mkdirSync(dirname(dst), { recursive: true });
          copyFileSync(src, dst);
        } catch (err) {
          console.error(`[worktree] failed to copy ${rel}:`, err);
        }
      }
    }
    return { workspaceId, worktreePath };
  }

  async destroy(params: DestroyParams): Promise<{ ok: true }> {
    await this.shell.run(["git", "worktree", "remove", "--force", params.worktreePath]);
    return { ok: true };
  }

  async list(params: ListParams): Promise<WorktreeInfo[]> {
    const output = await this.shell.text(["git", "worktree", "list", "--porcelain"], params.projectPath);
    const blocks = output.split(/\n\n+/);
    const results: WorktreeInfo[] = [];
    for (const block of blocks) {
      const info: WorktreeInfo = { path: "" };
      for (const line of block.split("\n")) {
        if (line.startsWith("worktree ")) info.path = line.slice("worktree ".length).trim();
        else if (line.startsWith("HEAD ")) info.head = line.slice("HEAD ".length).trim();
        else if (line.startsWith("branch ")) info.branch = line.slice("branch ".length).trim();
      }
      if (info.path) results.push(info);
    }
    return results;
  }

  async prune(params: ListParams): Promise<{ ok: true }> {
    await this.shell.run(["git", "worktree", "prune"], params.projectPath);
    return { ok: true };
  }
}
