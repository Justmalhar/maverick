import { defaultShell } from "./deps";
import type { Commit, DiffStat, Shell, Stash } from "./types";

interface LogParams {
  worktreePath: string;
  limit?: number;
}

interface CommitParams {
  worktreePath: string;
  message: string;
  files?: string[];
}

interface StashParams {
  worktreePath: string;
}

interface BranchParams {
  worktreePath: string;
  name: string;
}

interface CheckoutParams {
  worktreePath: string;
  ref: string;
}

interface CherryPickParams {
  worktreePath: string;
  sha: string;
}

export interface GitModuleOptions {
  shell?: Shell;
}

export class GitModule {
  private shell: Shell;

  constructor(opts: GitModuleOptions = {}) {
    this.shell = opts.shell ?? defaultShell;
  }

  async log(params: LogParams): Promise<Commit[]> {
    const limit = params.limit ?? 50;
    const output = await this.shell.text(
      [
        "git",
        "-C",
        params.worktreePath,
        "log",
        `--max-count=${limit}`,
        "--pretty=format:%H%x09%an%x09%at%x09%s",
        "--shortstat",
      ],
      undefined
    );
    return GitModule.parseLog(output);
  }

  async stashList(params: StashParams): Promise<Stash[]> {
    const output = await this.shell.text(
      ["git", "-C", params.worktreePath, "stash", "list", "--pretty=format:%gd%x09%ct%x09%gs"],
      undefined
    );
    return GitModule.parseStashList(output);
  }

  async commit(params: CommitParams): Promise<{ sha: string }> {
    if (params.files && params.files.length > 0) {
      await this.shell.run(["git", "-C", params.worktreePath, "add", "--", ...params.files], undefined);
    }
    const { exitCode, stderr } = await this.shell.run(
      ["git", "-C", params.worktreePath, "commit", "-m", params.message],
      undefined
    );
    if (exitCode !== 0) throw new Error(stderr || "git commit failed");
    const sha = (await this.shell.text(["git", "-C", params.worktreePath, "rev-parse", "HEAD"], undefined)).trim();
    return { sha };
  }

  async push(params: { worktreePath: string; remote?: string; branch?: string }): Promise<{ ok: true }> {
    const cmd = ["git", "-C", params.worktreePath, "push"];
    if (params.remote) cmd.push(params.remote);
    if (params.branch) cmd.push(params.branch);
    const { exitCode, stderr } = await this.shell.run(cmd, undefined);
    if (exitCode !== 0) throw new Error(stderr || "git push failed");
    return { ok: true };
  }

  async pull(params: { worktreePath: string }): Promise<{ ok: true }> {
    const { exitCode, stderr } = await this.shell.run(["git", "-C", params.worktreePath, "pull"], undefined);
    if (exitCode !== 0) throw new Error(stderr || "git pull failed");
    return { ok: true };
  }

  async fetch(params: { worktreePath: string; remote?: string }): Promise<{ ok: true }> {
    const cmd = ["git", "-C", params.worktreePath, "fetch"];
    if (params.remote) cmd.push(params.remote);
    const { exitCode, stderr } = await this.shell.run(cmd, undefined);
    if (exitCode !== 0) throw new Error(stderr || "git fetch failed");
    return { ok: true };
  }

  async branchList(params: StashParams): Promise<string[]> {
    const output = await this.shell.text(
      ["git", "-C", params.worktreePath, "branch", "--list", "--format=%(refname:short)"],
      undefined
    );
    return output.split("\n").map((l) => l.trim()).filter(Boolean);
  }

  async branchCreate(params: BranchParams): Promise<{ ok: true }> {
    const { exitCode, stderr } = await this.shell.run(
      ["git", "-C", params.worktreePath, "branch", params.name],
      undefined
    );
    if (exitCode !== 0) throw new Error(stderr || "git branch failed");
    return { ok: true };
  }

  async branchDelete(params: BranchParams): Promise<{ ok: true }> {
    const { exitCode, stderr } = await this.shell.run(
      ["git", "-C", params.worktreePath, "branch", "-D", params.name],
      undefined
    );
    if (exitCode !== 0) throw new Error(stderr || "git branch -D failed");
    return { ok: true };
  }

  async checkout(params: CheckoutParams): Promise<{ ok: true }> {
    const { exitCode, stderr } = await this.shell.run(
      ["git", "-C", params.worktreePath, "checkout", params.ref],
      undefined
    );
    if (exitCode !== 0) throw new Error(stderr || "git checkout failed");
    return { ok: true };
  }

  async cherryPick(params: CherryPickParams): Promise<{ ok: true }> {
    const { exitCode, stderr } = await this.shell.run(
      ["git", "-C", params.worktreePath, "cherry-pick", params.sha],
      undefined
    );
    if (exitCode !== 0) throw new Error(stderr || "git cherry-pick failed");
    return { ok: true };
  }

  async prCreate(params: {
    worktreePath: string;
    title?: string;
    body?: string;
    base?: string;
  }): Promise<{ url: string }> {
    const branch = (
      await this.shell.text(
        ["git", "-C", params.worktreePath, "rev-parse", "--abbrev-ref", "HEAD"],
        undefined
      )
    ).trim();

    // gh needs the branch on the remote before it can open a PR.
    const push = await this.shell.run(
      ["git", "-C", params.worktreePath, "push", "-u", "origin", branch],
      undefined
    );
    if (push.exitCode !== 0) throw new Error(push.stderr || "git push failed");

    const cmd = ["gh", "pr", "create", "--head", branch];
    if (params.base) cmd.push("--base", params.base);
    if (params.title) {
      cmd.push("--title", params.title);
      cmd.push("--body", params.body ?? "");
    } else {
      cmd.push("--fill");
    }
    const { exitCode, stdout, stderr } = await this.shell.run(cmd, params.worktreePath);
    if (exitCode !== 0) throw new Error(stderr || "gh pr create failed");
    return { url: stdout.trim() };
  }

  static parseLog(output: string): Commit[] {
    if (!output.trim()) return [];
    const lines = output.split("\n");
    const commits: Commit[] = [];
    let i = 0;
    while (i < lines.length) {
      const headerLine = lines[i];
      if (!headerLine || !headerLine.includes("\t")) {
        i++;
        continue;
      }
      const [sha, author, ts, ...rest] = headerLine.split("\t");
      const message = rest.join("\t");
      let fileCount = 0;
      const statLine = lines[i + 1] ?? "";
      const filesMatch = statLine.match(/(\d+) files? changed/);
      if (filesMatch) {
        fileCount = parseInt(filesMatch[1], 10);
        i += 2;
      } else {
        i += 1;
      }
      while (i < lines.length && lines[i] === "") i++;
      commits.push({
        sha,
        author,
        timestamp: parseInt(ts, 10),
        message,
        fileCount,
      });
    }
    return commits;
  }

  static parseStashList(output: string): Stash[] {
    if (!output.trim()) return [];
    return output
      .split("\n")
      .filter(Boolean)
      .map((line, index) => {
        const [ref, ts, message] = line.split("\t");
        const branchMatch = message?.match(/On ([^:]+):/);
        return {
          index: parseInt(ref?.replace(/[^0-9]/g, "") || `${index}`, 10),
          message: message ?? "",
          branch: branchMatch ? branchMatch[1].trim() : "",
          timestamp: parseInt(ts ?? "0", 10),
        };
      });
  }

  async branches(params: { projectPath: string }): Promise<string[]> {
    const localOut = await this.shell.text(
      ["git", "-C", params.projectPath, "branch", "--list", "--format=%(refname:short)"],
      undefined
    );
    const local = localOut.split("\n").map((l) => l.trim()).filter(Boolean);

    let worktrees: string[] = [];
    try {
      const wtOut = await this.shell.text(
        ["git", "-C", params.projectPath, "worktree", "list", "--porcelain"],
        undefined
      );
      worktrees = GitModule.parseWorktreePaths(wtOut)
        .slice(1)
        .map((p) => `worktree/${p}`);
    } catch {
      // worktrees are optional
    }

    return [...local, ...worktrees];
  }

  async diffStat(params: { worktreePath: string }): Promise<DiffStat> {
    try {
      const output = await this.shell.text(
        ["git", "-C", params.worktreePath, "diff", "--shortstat", "HEAD"],
        undefined
      );
      return GitModule.parseDiffStat(output);
    } catch {
      return { added: 0, removed: 0 };
    }
  }

  static parseWorktreePaths(output: string): string[] {
    const paths: string[] = [];
    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        paths.push(line.slice("worktree ".length).trim());
      }
    }
    return paths;
  }

  static parseDiffStat(output: string): DiffStat {
    const added = parseInt(output.match(/(\d+) insertion/)?.[1] ?? "0", 10);
    const removed = parseInt(output.match(/(\d+) deletion/)?.[1] ?? "0", 10);
    return { added, removed };
  }
}
