import { isAbsolute, join } from "path";
import { unlink, writeFile as fsWriteFile } from "fs/promises";
import { defaultShell } from "./deps";
import { parseRemoteUrl, prWebUrl } from "./git-provider";
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

/** Writes UTF-8 text to a path in-process (used for per-hunk conflict resolution). */
export type FileWriter = (path: string, content: string) => Promise<void>;

const defaultFileReader: FileReader = (path) => Bun.file(path).arrayBuffer();

const defaultFileWriter: FileWriter = (path, content) => fsWriteFile(path, content, "utf8");

export interface GitModuleOptions {
  shell?: Shell;
  readFile?: FileReader;
  writeFile?: FileWriter;
  removeFile?: (path: string) => Promise<void>;
}

export class GitModule {
  private shell: Shell;
  private readFile: FileReader;
  private writeFile: FileWriter;
  private removeFile: (path: string) => Promise<void>;

  constructor(opts: GitModuleOptions = {}) {
    this.shell = opts.shell ?? defaultShell;
    this.readFile = opts.readFile ?? defaultFileReader;
    this.writeFile = opts.writeFile ?? defaultFileWriter;
    this.removeFile = opts.removeFile ?? ((p) => unlink(p));
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
    const commitCmd = ["git", "-C", params.worktreePath, "commit", "-m", params.message];
    if (params.files && params.files.length > 0) {
      await this.shell.run(["git", "-C", params.worktreePath, "add", "--", ...params.files], undefined);
      // Scope the commit to exactly these paths (`commit -- <paths>` acts like
      // --only) so anything else already in the index — a hunk staged via
      // diff_stage_hunk, or files an agent ran `git add` on — is NOT swept in
      // alongside the user's per-file selection, and stays staged afterwards.
      commitCmd.push("--", ...params.files);
    }
    const { exitCode, stderr } = await this.shell.run(commitCmd, undefined);
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

  /**
   * Rename the worktree's CURRENT branch (`git branch -m <new>`). Used by the
   * "AI rename" flow once an agent has done enough work to name the branch from
   * its diff. The worktree directory name is intentionally left unchanged (it is
   * cosmetic and decoupled from the ref via dirName at create time).
   */
  async renameBranch(params: { worktreePath: string; newBranch: string }): Promise<{ ok: true; branch: string }> {
    const { exitCode, stderr } = await this.shell.run(
      ["git", "-C", params.worktreePath, "branch", "-m", params.newBranch],
      undefined
    );
    if (exitCode !== 0) throw new Error(stderr || "git branch -m failed");
    return { ok: true, branch: params.newBranch };
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
   * For a remote-tracking ref (e.g. `origin/feat`) we strip the remote so git's
   * DWIM creates/switches to a local tracking branch instead of detaching HEAD.
   */
  async checkoutBranch(params: BranchCheckoutParams): Promise<{ ok: true }> {
    const ref = await this.resolveCheckoutRef(params.worktreePath, params.branch);
    return this.checkout({ worktreePath: params.worktreePath, ref });
  }

  /**
   * `branchList` reports remote branches as `<remote>/<branch>` (the `refs/remotes/`
   * prefix already stripped), and `git checkout origin/feat` checks out the
   * remote-tracking ref directly → DETACHED HEAD. Strip the leading remote
   * segment so `git checkout <branch>` DWIMs into a local tracking branch — but
   * ONLY when that segment names a real configured remote and no local branch of
   * the full name exists, so a genuine local branch like `feature/login` (or even
   * one literally named `origin/x`) is left untouched.
   */
  private async resolveCheckoutRef(worktreePath: string, branch: string): Promise<string> {
    const ref = branch.startsWith("remotes/") ? branch.slice("remotes/".length) : branch;
    const slash = ref.indexOf("/");
    if (slash <= 0) return ref;
    const candidateRemote = ref.slice(0, slash);
    const remotes = (await this.shell.text(["git", "-C", worktreePath, "remote"], undefined))
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean);
    if (!remotes.includes(candidateRemote)) return ref;
    const local = await this.shell.run(
      ["git", "-C", worktreePath, "rev-parse", "--verify", "--quiet", `refs/heads/${ref}`],
      undefined
    );
    if (local.exitCode === 0) return ref;
    return ref.slice(slash + 1);
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

  /** File content at a ref (`git show REF:path`); `missing` when the path did not exist there. */
  async showAtRef(params: { worktreePath: string; filePath: string; ref: string }): Promise<{ content: string; missing: boolean }> {
    const { exitCode, stdout, stderr } = await this.shell.run(
      ["git", "-C", params.worktreePath, "show", `${params.ref}:${params.filePath}`],
      undefined
    );
    if (exitCode === 0) return { content: stdout, missing: false };
    if (/does not exist|exists on disk, but not in/i.test(stderr)) return { content: "", missing: true };
    throw new Error(stderr || "git show failed");
  }

  /** Undo working-tree changes: restore tracked files from HEAD, delete untracked ones. */
  async discardFile(params: { worktreePath: string; filePath: string }): Promise<{ ok: true }> {
    if (isAbsolute(params.filePath)) {
      throw new Error(`filePath must be relative to the worktree root: ${params.filePath}`);
    }
    const tracked = await this.shell.run(
      ["git", "-C", params.worktreePath, "ls-files", "--error-unmatch", "--", params.filePath],
      undefined
    );
    if (tracked.exitCode === 0) {
      const { exitCode, stderr } = await this.shell.run(
        ["git", "-C", params.worktreePath, "checkout", "HEAD", "--", params.filePath],
        undefined
      );
      if (exitCode !== 0) throw new Error(stderr || "git checkout (discard) failed");
    } else {
      await this.removeFile(join(params.worktreePath, params.filePath));
    }
    return { ok: true };
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
    const content = await this.readConflictWorkingTree(params.worktreePath, params.filePath);
    // Binary or unreadable: there are no per-hunk regions to rewrite, so fall
    // back to a whole-file ours/theirs checkout (the only sensible choice), then
    // stage it. "both" on a binary file is meaningless — keep the working copy.
    if (content === null) {
      if (params.resolution !== "both") {
        const arg = params.resolution === "ours" ? "--ours" : "--theirs";
        const checkout = await this.shell.run(
          ["git", "-C", params.worktreePath, "checkout", arg, "--", params.filePath],
          undefined
        );
        if (checkout.exitCode !== 0) throw new Error(checkout.stderr || "git checkout (resolve) failed");
      }
      await this.stageResolved(params.worktreePath, params.filePath);
      return { ok: true };
    }

    // Rewrite ONLY the targeted hunk, leaving every other hunk's markers intact,
    // then write the file back. A whole-file `git checkout --ours/--theirs` would
    // silently resolve every hunk and discard the user's other choices.
    const rewritten = GitModule.applyConflictResolution(content, params.hunkIndex, params.resolution);
    await this.writeFile(join(params.worktreePath, params.filePath), rewritten);

    // Stage the file only once it is fully resolved (no markers remain); while
    // other hunks are still open, leave it unstaged so it stays in the list.
    if (!GitModule.hasConflictMarkers(rewritten)) {
      await this.stageResolved(params.worktreePath, params.filePath);
    }
    return { ok: true };
  }

  private async stageResolved(worktreePath: string, filePath: string): Promise<void> {
    const add = await this.shell.run(["git", "-C", worktreePath, "add", "--", filePath], undefined);
    if (add.exitCode !== 0) throw new Error(add.stderr || "git add (resolve) failed");
  }

  static hasConflictMarkers(content: string): boolean {
    return content.split("\n").some((l) => l.startsWith("<<<<<<<") || l.startsWith(">>>>>>>"));
  }

  /**
   * Replace the `hunkIndex`-th conflict region (counting `<<<<<<<` markers, same
   * order as {@link parseConflictMarkers}) with the chosen side and DROP its
   * markers; every other region is reproduced verbatim. `both` keeps ours then
   * theirs. Handles diff3 (`|||||||` base block) by discarding the base section.
   */
  static applyConflictResolution(
    content: string,
    hunkIndex: number,
    resolution: ConflictResolution
  ): string {
    const lines = content.split("\n");
    const out: string[] = [];
    let region = -1;
    let i = 0;
    while (i < lines.length) {
      if (!lines[i].startsWith("<<<<<<<")) {
        out.push(lines[i]);
        i++;
        continue;
      }
      region++;
      const raw: string[] = [lines[i]];
      const ours: string[] = [];
      const theirs: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("|||||||") && !lines[i].startsWith("=======")) {
        ours.push(lines[i]);
        raw.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].startsWith("|||||||")) {
        raw.push(lines[i]);
        i++;
        while (i < lines.length && !lines[i].startsWith("=======")) {
          raw.push(lines[i]);
          i++;
        }
      }
      if (i < lines.length && lines[i].startsWith("=======")) {
        raw.push(lines[i]);
        i++;
      }
      while (i < lines.length && !lines[i].startsWith(">>>>>>>")) {
        theirs.push(lines[i]);
        raw.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].startsWith(">>>>>>>")) {
        raw.push(lines[i]);
        i++;
      }
      if (region === hunkIndex) {
        if (resolution === "ours") out.push(...ours);
        else if (resolution === "theirs") out.push(...theirs);
        else out.push(...ours, ...theirs);
      } else {
        out.push(...raw);
      }
    }
    return out.join("\n");
  }

  // Every local and remote branch short name; used for unique workspace-name
  // generation (origin/HEAD alias filtered out).
  async allBranchNames(params: { projectPath: string }): Promise<string[]> {
    const output = await this.shell.text(
      [
        "git",
        "-C",
        params.projectPath,
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/heads",
        "refs/remotes",
      ],
      undefined
    );
    const names = new Set<string>();
    for (const line of output.split("\n")) {
      const ref = line.trim();
      if (!ref || ref.endsWith("/HEAD")) continue;
      names.add(ref);
      // origin/feature also blocks the bare name "feature".
      const slash = ref.indexOf("/");
      if (slash > 0) names.add(ref.slice(slash + 1));
    }
    return [...names];
  }

  async remoteInfo(params: { worktreePath: string; remote?: string }) {
    const remote = params.remote ?? "origin";
    const url = (
      await this.shell.text(
        ["git", "-C", params.worktreePath, "remote", "get-url", remote],
        undefined
      )
    ).trim();
    const info = parseRemoteUrl(url);
    if (!info) throw new Error(`unrecognized remote URL for ${remote}: ${url}`);
    return info;
  }

  async prCreate(params: {
    worktreePath: string;
    title?: string;
    body?: string;
    base?: string;
    remote?: string;
  }): Promise<{ url: string }> {
    const remote = params.remote ?? "origin";
    const branch = (
      await this.shell.text(
        ["git", "-C", params.worktreePath, "rev-parse", "--abbrev-ref", "HEAD"],
        undefined
      )
    ).trim();

    // Every provider needs the branch on the remote before a PR can exist.
    const push = await this.shell.run(
      ["git", "-C", params.worktreePath, "push", "-u", remote, branch],
      undefined
    );
    if (push.exitCode !== 0) throw new Error(push.stderr || "git push failed");

    const info = await this.remoteInfo({ worktreePath: params.worktreePath, remote });

    if (info.provider === "github") {
      const cmd = ["gh", "pr", "create", "--head", branch];
      if (params.base) cmd.push("--base", params.base);
      if (params.title) {
        cmd.push("--title", params.title);
        cmd.push("--body", params.body ?? "");
      } else {
        cmd.push("--fill");
      }
      try {
        const { exitCode, stdout, stderr } = await this.shell.run(cmd, params.worktreePath);
        if (exitCode === 0) return { url: stdout.trim() };
        // gh unauthenticated/misconfigured: the compare URL still gets the PR made.
        if (/not found|command not found|auth/i.test(stderr)) {
          return { url: prWebUrl(info, branch, params.base) };
        }
        throw new Error(stderr || "gh pr create failed");
      } catch (err) {
        // Bun.spawn throws ENOENT when gh is not installed at all.
        if (err instanceof Error && /enoent|no such file/i.test(err.message)) {
          return { url: prWebUrl(info, branch, params.base) };
        }
        throw err;
      }
    }

    if (info.provider === "bitbucket" || info.provider === "gitlab") {
      return { url: prWebUrl(info, branch, params.base) };
    }

    throw new Error(
      `branch pushed to ${remote}, but no supported provider detected for ${info.host} — open a PR manually`
    );
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
