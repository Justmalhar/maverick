import { existsSync, statSync, mkdirSync, copyFileSync, realpathSync } from "fs";
import { homedir } from "os";
import { join, dirname, isAbsolute, resolve, sep } from "path";
import { defaultIds, defaultShell } from "./deps";
import { slugify } from "./name-generator";
import type { IdProvider, Shell } from "./types";

interface CreateParams {
  projectPath: string;
  branch: string;
  baseBranch?: string;
  filesToCopy?: string[];
  // Worktree root for this call (settings.workspaces.basePath or the
  // ~/.maverick default); falls back to the constructor-level base.
  base?: string;
  // Human-readable directory name (branch slug); falls back to workspaceId.
  dirName?: string;
}

// Worktrees live outside the repo so they never pollute the user's checkout:
// ~/.maverick/<project-slug>/worktrees/<workspace>.
export function defaultWorktreeRoot(projectName: string): string {
  return join(homedir(), ".maverick", slugify(projectName), "worktrees");
}

interface DestroyParams {
  worktreePath: string;
  projectPath?: string;
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

// Returns the canonical (symlink-resolved) form of `path` if it exists on disk,
// else the canonical form of its nearest existing ancestor with the missing
// suffix re-appended. We must canonicalize because git itself reports worktrees
// by their real path (e.g. /var -> /private/var on macOS); comparing a raw
// `join()` result against a canonical root would spuriously reject valid paths.
function canonicalize(path: string): string {
  const abs = resolve(path);
  let cur = abs;
  const suffix: string[] = [];
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) return abs;
    suffix.unshift(cur.slice(parent.length + 1));
    cur = parent;
  }
  const realBase = realpathSync(cur);
  return suffix.length === 0 ? realBase : join(realBase, ...suffix);
}

// True when `child` is `root` itself or lives strictly beneath it, comparing
// canonical paths with a trailing separator so `/a/workspaces-evil` is not
// treated as inside `/a/workspaces`.
function isWithin(root: string, child: string): boolean {
  const r = canonicalize(root);
  const c = canonicalize(child);
  if (c === r) return true;
  return c.startsWith(r.endsWith(sep) ? r : r + sep);
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

  // Anchors the (possibly relative) `base` at the project root so the resulting
  // worktree path is absolute and identical regardless of the sidecar process
  // cwd. create/destroy/copy all route through this so git sees the same path.
  private worktreeRoot(projectPath: string, base?: string): string {
    const b = base ?? this.base;
    return isAbsolute(b) ? b : resolve(projectPath, b);
  }

  private resolveWorktreePath(
    projectPath: string,
    workspaceId: string,
    base?: string,
    dirName?: string
  ): string {
    const root = this.worktreeRoot(projectPath, base);
    // A stale directory from a pruned worktree may still hold the friendly
    // name; suffix with the id tail rather than failing the create.
    let name = dirName ?? workspaceId;
    if (dirName && existsSync(join(root, name))) {
      name = `${dirName}-${workspaceId.slice(-6)}`;
    }
    const wt = join(root, name);
    if (!isWithin(root, wt)) {
      throw new Error(`worktree path escapes workspaces root: ${wt}`);
    }
    return wt;
  }

  // First candidate that resolves to a real ref wins; HEAD always resolves so
  // a repo with no main/master still gets a valid base.
  async resolveBaseBranch(projectPath: string, candidates: Array<string | undefined>): Promise<string> {
    for (const candidate of candidates) {
      if (!candidate || !candidate.trim()) continue;
      const r = await this.shell.run(
        ["git", "rev-parse", "--verify", "--quiet", `${candidate}^{commit}`],
        projectPath
      );
      if (r.exitCode === 0) return candidate;
    }
    return "HEAD";
  }

  async create(params: CreateParams): Promise<{ workspaceId: string; worktreePath: string }> {
    const workspaceId = this.ids.uuid("ws");
    const worktreePath = this.resolveWorktreePath(
      params.projectPath,
      workspaceId,
      params.base,
      params.dirName
    );
    const baseBranch = params.baseBranch ?? params.branch;
    const add = await this.shell.run(
      ["git", "worktree", "add", "-b", params.branch, worktreePath, baseBranch],
      params.projectPath
    );
    if (add.exitCode !== 0) {
      throw new Error(add.stderr.trim() || `git worktree add exited ${add.exitCode}`);
    }
    if (params.filesToCopy && params.filesToCopy.length > 0) {
      this.copy(params.projectPath, worktreePath, params.filesToCopy);
    }
    return { workspaceId, worktreePath };
  }

  // Copies project-relative files into the worktree. dst is resolved against the
  // real (absolute) worktreePath — never the sidecar cwd — and every entry is
  // confined to the worktree so a crafted `../` path cannot write outside it.
  copy(projectPath: string, worktreePath: string, filesToCopy: string[]): void {
    for (const rel of filesToCopy) {
      const src = resolve(projectPath, rel);
      const dst = resolve(worktreePath, rel);
      try {
        if (!isWithin(projectPath, src) || !isWithin(worktreePath, dst)) {
          console.error(`[worktree] refusing to copy out-of-tree path: ${rel}`);
          continue;
        }
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

  async destroy(params: DestroyParams): Promise<{ ok: true }> {
    // Run remove from the project root (when known) so a relative-base worktree
    // resolves identically to create; pass the absolute worktree path so it also
    // works when no projectPath is supplied. A failed remove falls back to prune
    // (the worktree dir may already be gone) so the caller can safely delete the
    // DB row without orphaning an unrecoverable worktree.
    const removeCwd = params.projectPath;
    try {
      const r = await this.shell.run(
        ["git", "worktree", "remove", "--force", params.worktreePath],
        removeCwd
      );
      if (r.exitCode !== 0) throw new Error(r.stderr || `exit ${r.exitCode}`);
    } catch (err) {
      const prune = await this.shell.run(
        ["git", "worktree", "prune"],
        removeCwd
      );
      if (prune.exitCode !== 0) {
        throw new Error(
          `worktree remove failed (${err instanceof Error ? err.message : String(err)}) and prune failed (${prune.stderr || prune.exitCode})`
        );
      }
    }
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
