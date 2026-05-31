import { join } from "path";
import { defaultShell } from "./deps";
import type {
  BlameLine,
  Branch,
  Commit,
  ConflictHunk,
  ConflictResolution,
  DiffStat,
  Shell,
  Stash,
} from "./types";

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

interface StashIndexParams {
  worktreePath: string;
  index: number;
}

interface BranchParams {
  worktreePath: string;
  name: string;
}

interface CheckoutParams {
  worktreePath: string;
  ref: string;
}

interface BranchCheckoutParams {
  worktreePath: string;
  branch: string;
}

interface CherryPickParams {
  worktreePath: string;
  sha: string;
}

interface BlameParams {
  worktreePath: string;
  filePath: string;
}

interface ResolveConflictParams {
  worktreePath: string;
  filePath: string;
  hunkIndex: number;
  resolution: ConflictResolution;
}

// Network ops can stall indefinitely on an unreachable remote even with prompts
// suppressed; cap them so a bad network surfaces as a typed timeout, not a hang.
const NETWORK_TIMEOUT_MS = 120_000;

/**
 * Typed git failure. `kind: "auth"` is emitted when git's stderr matches a known
 * credential/host-key pattern — the UI maps this to a "configure your CLI auth"
 * affordance rather than a raw stderr dump. CLAUDE.md rule 5: Maverick never
 * stores keys, so we cannot retry; we fail fast with an actionable message.
 */
export class GitError extends Error {
  readonly kind: "auth" | "no_upstream" | "timeout" | "failed";
  constructor(kind: GitError["kind"], message: string) {
    super(message);
    this.name = "GitError";
    this.kind = kind;
  }
}

/** Reads a file's raw bytes in-process. Rejects if the path is unreadable. */
export type FileReader = (path: string) => Promise<ArrayBuffer>;

const defaultFileReader: FileReader = (path) => Bun.file(path).arrayBuffer();

export interface GitModuleOptions {
  shell?: Shell;
  readFile?: FileReader;
}

export class GitModule {
  private shell: Shell;
  private readFile: FileReader;

  constructor(opts: GitModuleOptions = {}) {
    this.shell = opts.shell ?? defaultShell;
    this.readFile = opts.readFile ?? defaultFileReader;
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
    await this.network(cmd, "git push");
    return { ok: true };
  }

  async pull(params: { worktreePath: string }): Promise<{ ok: true }> {
    await this.network(["git", "-C", params.worktreePath, "pull"], "git pull");
    return { ok: true };
  }

  async fetch(params: { worktreePath: string; remote?: string }): Promise<{ ok: true }> {
    const cmd = ["git", "-C", params.worktreePath, "fetch"];
    if (params.remote) cmd.push(params.remote);
    await this.network(cmd, "git fetch");
    return { ok: true };
  }

  /**
   * Run a remote-touching git command with a network timeout and typed-error
   * classification. The shell already runs with GIT_TERMINAL_PROMPT=0 so a
   * missing credential fails instead of blocking; we translate the resulting
   * stderr into a {@link GitError} the frontend can branch on.
   */
  private async network(cmd: string[], context: string): Promise<void> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new GitError("timeout", `${context} timed out`)), NETWORK_TIMEOUT_MS)
    );
    const { exitCode, stderr } = await Promise.race([this.shell.run(cmd, undefined), timeout]);
    if (exitCode !== 0) throw GitModule.classifyError(stderr, context);
  }

  static classifyError(stderr: string, context: string): GitError {
    const detail = stderr.trim();
    const lower = detail.toLowerCase();
    if (
      lower.includes("could not read username") ||
      lower.includes("could not read password") ||
      lower.includes("authentication failed") ||
      lower.includes("permission denied (publickey)") ||
      lower.includes("invalid credentials") ||
      lower.includes("host key verification failed") ||
      lower.includes("terminal prompts disabled")
    ) {
      const first = detail.split("\n")[0] || detail;
      return new GitError(
        "auth",
        `authentication required: ${first}. Configure your git credential helper or SSH key in the CLI; Maverick does not store keys.`
      );
    }
    if (lower.includes("no upstream") || lower.includes("no configured push destination")) {
      return new GitError(
        "no_upstream",
        "no upstream configured. Run `git push -u <remote> <branch>` once in the terminal."
      );
    }
    return new GitError("failed", detail || `${context} failed`);
  }

  /** Rich local + remote branch list with per-branch upstream/ahead/behind. */
  async branchList(params: StashParams): Promise<Branch[]> {
    // %(HEAD) marks the current branch with "*"; the upstream:track field yields
    // "[ahead N, behind M]" which we parse rather than running N extra rev-list calls.
    const fmt =
      "%(HEAD)%09%(refname)%09%(upstream:short)%09%(upstream:track,nobracket)";
    const output = await this.shell.text(
      ["git", "-C", params.worktreePath, "for-each-ref", `--format=${fmt}`, "refs/heads", "refs/remotes"],
      undefined
    );
    return GitModule.parseBranches(output);
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

  /**
   * Frontend `git_checkout` sends `{ branch }`; this is the canonical shape.
   * For a remote-tracking ref (e.g. `origin/feat`) we strip the remote and let
   * git auto-create the local tracking branch via `--`-free checkout of the short name.
   */
  async checkoutBranch(params: BranchCheckoutParams): Promise<{ ok: true }> {
    const ref = params.branch.startsWith("remotes/")
      ? params.branch.slice("remotes/".length)
      : params.branch;
    return this.checkout({ worktreePath: params.worktreePath, ref });
  }

  async cherryPick(params: CherryPickParams): Promise<{ ok: true }> {
    const { exitCode, stderr } = await this.shell.run(
      ["git", "-C", params.worktreePath, "cherry-pick", params.sha],
      undefined
    );
    if (exitCode !== 0) throw new Error(stderr || "git cherry-pick failed");
    return { ok: true };
  }

  async blame(params: BlameParams): Promise<BlameLine[]> {
    const output = await this.shell.text(
      ["git", "-C", params.worktreePath, "blame", "--line-porcelain", "--", params.filePath],
      undefined
    );
    return GitModule.parseBlame(output);
  }

  async stashApply(params: StashIndexParams): Promise<{ ok: true }> {
    return this.stashAction(params, "apply");
  }

  async stashPop(params: StashIndexParams): Promise<{ ok: true }> {
    return this.stashAction(params, "pop");
  }

  async stashDrop(params: StashIndexParams): Promise<{ ok: true }> {
    return this.stashAction(params, "drop");
  }

  private async stashAction(
    params: StashIndexParams,
    action: "apply" | "pop" | "drop"
  ): Promise<{ ok: true }> {
    const { exitCode, stderr } = await this.shell.run(
      ["git", "-C", params.worktreePath, "stash", action, `stash@{${params.index}}`],
      undefined
    );
    if (exitCode !== 0) throw GitModule.classifyError(stderr, `git stash ${action}`);
    return { ok: true };
  }

  /** Parse unmerged paths into per-hunk ours/theirs blocks for the resolver UI. */
  async conflicts(params: StashParams): Promise<ConflictHunk[]> {
    const output = await this.shell.text(
      ["git", "-C", params.worktreePath, "diff", "--name-only", "--diff-filter=U"],
      undefined
    );
    const paths = output.split("\n").map((l) => l.trim()).filter(Boolean);
    const hunks: ConflictHunk[] = [];
    for (const filePath of paths) {
      let content: string;
      try {
        content = await this.shell.text(["git", "-C", params.worktreePath, "show", `:1:${filePath}`], undefined);
      } catch {
        content = "";
      }
      // We read the working-tree file (it carries the conflict markers) in-process;
      // base is best-effort via the index stage 1 above and may be empty for add/add.
      const working = await this.readConflictWorkingTree(params.worktreePath, filePath);
      if (working === null) {
        // Binary or unreadable conflict: cannot surface text hunks, so emit a
        // flagged entry the UI can route to manual resolution instead of
        // silently reporting zero conflicts for the file.
        hunks.push({ filePath, hunkIndex: 0, ours: [], theirs: [], binary: true });
        continue;
      }
      hunks.push(...GitModule.parseConflictMarkers(filePath, working, content));
    }
    return hunks;
  }

  /**
   * Read a conflicted working-tree file as text. Returns `null` for binary
   * content (NUL byte present, git's own heuristic) or an unreadable path so the
   * caller can flag it rather than swallow the error. Read errors are not
   * swallowed silently — a missing/unreadable path maps to the same `null`
   * signal, never a spurious empty string that hides the conflict.
   */
  private async readConflictWorkingTree(
    worktreePath: string,
    filePath: string
  ): Promise<string | null> {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await this.readFile(join(worktreePath, filePath)));
    } catch {
      return null;
    }
    if (bytes.includes(0)) return null;
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }

  async resolveConflict(params: ResolveConflictParams): Promise<{ ok: true }> {
    // "both" keeps the user's hand-edited working tree (which still carries the
    // conflict markers they resolve in-editor) and simply stages it. There is no
    // `git checkout --merge <file>` flag, so we only check out for whole-file
    // ours/theirs resolutions; every path ends by staging the file.
    if (params.resolution !== "both") {
      const arg = params.resolution === "ours" ? "--ours" : "--theirs";
      const checkout = await this.shell.run(
        ["git", "-C", params.worktreePath, "checkout", arg, "--", params.filePath],
        undefined
      );
      if (checkout.exitCode !== 0) throw new Error(checkout.stderr || "git checkout (resolve) failed");
    }
    const add = await this.shell.run(
      ["git", "-C", params.worktreePath, "add", "--", params.filePath],
      undefined
    );
    if (add.exitCode !== 0) throw new Error(add.stderr || "git add (resolve) failed");
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

  static parseBranches(output: string): Branch[] {
    if (!output.trim()) return [];
    const branches: Branch[] = [];
    for (const line of output.split("\n")) {
      if (!line.trim() || !line.includes("\t")) continue;
      const [head, refname, upstream, track] = line.split("\t");
      const isCurrent = head === "*";
      const isRemote = refname.startsWith("refs/remotes/");
      const name = refname
        .replace(/^refs\/heads\//, "")
        .replace(/^refs\/remotes\//, "");
      // git lists the remote symbolic ref `origin/HEAD -> origin/main`; skip the alias.
      if (isRemote && name.endsWith("/HEAD")) continue;
      const branch: Branch = { name, isRemote, isCurrent };
      if (upstream) branch.upstream = upstream;
      const ahead = track ? parseInt(track.match(/ahead (\d+)/)?.[1] ?? "", 10) : NaN;
      const behind = track ? parseInt(track.match(/behind (\d+)/)?.[1] ?? "", 10) : NaN;
      if (!Number.isNaN(ahead)) branch.ahead = ahead;
      if (!Number.isNaN(behind)) branch.behind = behind;
      branches.push(branch);
    }
    return branches;
  }

  static parseBlame(output: string): BlameLine[] {
    if (!output.trim()) return [];
    const lines: BlameLine[] = [];
    const tokens = output.split("\n");
    let i = 0;
    while (i < tokens.length) {
      const headerMatch = tokens[i].match(/^([0-9a-f]{7,40}) \d+ (\d+)(?: \d+)?$/);
      if (!headerMatch) {
        i++;
        continue;
      }
      const sha = headerMatch[1];
      const lineNumber = parseInt(headerMatch[2], 10);
      let author = "";
      let timestamp = 0;
      let content = "";
      i++;
      while (i < tokens.length) {
        const tok = tokens[i];
        if (tok.startsWith("author ")) {
          author = tok.slice("author ".length);
        } else if (tok.startsWith("author-time ")) {
          timestamp = parseInt(tok.slice("author-time ".length), 10) || 0;
        } else if (tok.startsWith("\t")) {
          content = tok.slice(1);
          i++;
          break;
        }
        i++;
      }
      lines.push({ sha, author, timestamp, lineNumber, content });
    }
    return lines;
  }

  /**
   * Split a conflicted file's content into per-hunk ours/theirs blocks using the
   * standard `<<<<<<< / ======= / >>>>>>>` markers. `base` (the `|||||||` block,
   * present only under diff3 style) is attached when seen.
   */
  static parseConflictMarkers(filePath: string, content: string, baseContent: string): ConflictHunk[] {
    const hunks: ConflictHunk[] = [];
    const lines = content.split("\n");
    let hunkIndex = 0;
    let state: "none" | "ours" | "base" | "theirs" = "none";
    let ours: string[] = [];
    let theirs: string[] = [];
    let base: string[] = [];
    for (const line of lines) {
      if (line.startsWith("<<<<<<<")) {
        state = "ours";
        ours = [];
        theirs = [];
        base = [];
        continue;
      }
      if (line.startsWith("|||||||") && state !== "none") {
        state = "base";
        continue;
      }
      if (line.startsWith("=======") && state !== "none") {
        state = "theirs";
        continue;
      }
      if (line.startsWith(">>>>>>>") && state !== "none") {
        const hunk: ConflictHunk = { filePath, hunkIndex, ours, theirs };
        if (base.length > 0) hunk.base = base;
        else if (baseContent.trim()) hunk.base = baseContent.split("\n");
        hunks.push(hunk);
        hunkIndex++;
        state = "none";
        continue;
      }
      if (state === "ours") ours.push(line);
      else if (state === "base") base.push(line);
      else if (state === "theirs") theirs.push(line);
    }
    return hunks;
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
