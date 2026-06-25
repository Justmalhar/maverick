import { defaultShell } from "./deps";
import { GitModule } from "./git-module";
import type { CheckItem, CheckStatus, ChecksReport, PrInfo, Shell } from "./types";

export type { CheckItem, CheckStatus, ChecksReport, PrInfo } from "./types";

// `gh` can stall on a slow/unreachable API; cap it so a bad network degrades to
// "gh unavailable" rather than hanging the Checks tab. Mirrors GitModule.network.
const GH_TIMEOUT_MS = 30_000;

const GH_FIELDS = "number,state,title,url,mergeable,statusCheckRollup";

export interface ChecksModuleOptions {
  shell?: Shell;
}

export class ChecksModule {
  private shell: Shell;

  constructor(opts: ChecksModuleOptions = {}) {
    this.shell = opts.shell ?? defaultShell;
  }

  async get(params: { worktreePath: string }): Promise<ChecksReport> {
    const wt = params.worktreePath;

    const branchOut = await this.shell.text(
      [
        "git",
        "-C",
        wt,
        "for-each-ref",
        "--format=%(HEAD)%09%(refname)%09%(upstream:short)%09%(upstream:track,nobracket)",
        "refs/heads",
      ],
      undefined
    );
    const current = GitModule.parseBranches(branchOut).find((b) => b.isCurrent) ?? null;

    const statusOut = await this.shell.text(
      ["git", "-C", wt, "status", "--porcelain"],
      undefined
    );
    const changedFiles = ChecksModule.countLines(statusOut);

    const conflictOut = await this.shell.text(
      ["git", "-C", wt, "diff", "--name-only", "--diff-filter=U"],
      undefined
    );
    const conflicts = ChecksModule.countLines(conflictOut);

    const git = {
      branch: current?.name ?? "",
      ahead: current?.ahead ?? 0,
      behind: current?.behind ?? 0,
      changedFiles,
      conflicts,
    };

    const { ghAvailable, pr, checks } = await this.ghPrView(wt);

    return {
      git,
      pr,
      ghAvailable,
      checks,
      merge: ChecksModule.mergeVerdict(git, pr, checks),
    };
  }

  private async ghPrView(
    worktreePath: string
  ): Promise<{ ghAvailable: boolean; pr: PrInfo | null; checks: CheckItem[] }> {
    const cmd = ["gh", "pr", "view", "--json", GH_FIELDS];
    let result: { stdout: string; stderr: string; exitCode: number };
    try {
      // timeoutMs kills a stalled `gh` instead of leaking it (the old race
      // abandoned the live child); a kill surfaces as exitCode 124 below.
      result = await this.shell.run(cmd, worktreePath, undefined, { timeoutMs: GH_TIMEOUT_MS });
    } catch {
      // ENOENT (gh not installed): treat as unavailable.
      return { ghAvailable: false, pr: null, checks: [] };
    }

    if (result.exitCode !== 0) {
      // A branch with no PR is the normal case, not a configuration problem.
      if (/no pull requests?\s+found/i.test(result.stderr)) {
        return { ghAvailable: true, pr: null, checks: [] };
      }
      // Auth / unknown failure: surface as "configure gh", not an error dump.
      return { ghAvailable: false, pr: null, checks: [] };
    }

    try {
      const data = JSON.parse(result.stdout) as Record<string, unknown>;
      const pr: PrInfo = {
        number: Number(data.number),
        url: String(data.url ?? ""),
        state: String(data.state ?? ""),
        title: String(data.title ?? ""),
        mergeable: String(data.mergeable ?? ""),
      };
      return { ghAvailable: true, pr, checks: ChecksModule.parseRollup(data.statusCheckRollup) };
    } catch {
      return { ghAvailable: true, pr: null, checks: [] };
    }
  }

  /** Normalize `gh`'s heterogeneous statusCheckRollup into typed CheckItems. */
  static parseRollup(rollup: unknown): CheckItem[] {
    if (!Array.isArray(rollup)) return [];
    return rollup.map((entry) => {
      if (!entry || typeof entry !== "object") {
        return { name: "unknown", status: "neutral" as CheckStatus };
      }
      const e = entry as Record<string, unknown>;
      if (e.__typename === "CheckRun") {
        const status =
          e.status !== "COMPLETED"
            ? "pending"
            : ChecksModule.checkRunConclusion(String(e.conclusion ?? ""));
        return { name: String(e.name ?? "unknown"), status };
      }
      if (e.__typename === "StatusContext") {
        return {
          name: String(e.context ?? "unknown"),
          status: ChecksModule.statusContextState(String(e.state ?? "")),
        };
      }
      return { name: "unknown", status: "neutral" as CheckStatus };
    });
  }

  private static checkRunConclusion(conclusion: string): CheckStatus {
    switch (conclusion) {
      case "SUCCESS":
        return "pass";
      case "FAILURE":
      case "CANCELLED":
      case "TIMED_OUT":
      case "ACTION_REQUIRED":
      case "STARTUP_FAILURE":
        return "fail";
      default:
        return "neutral";
    }
  }

  private static statusContextState(state: string): CheckStatus {
    switch (state) {
      case "SUCCESS":
        return "pass";
      case "FAILURE":
      case "ERROR":
        return "fail";
      case "PENDING":
      case "EXPECTED":
        return "pending";
      default:
        return "neutral";
    }
  }

  static countLines(output: string): number {
    return output.split("\n").filter((l) => l.trim() !== "").length;
  }

  static mergeVerdict(
    git: ChecksReport["git"],
    pr: PrInfo | null,
    checks: CheckItem[]
  ): { ready: boolean; blockers: string[] } {
    const blockers: string[] = [];
    if (git.changedFiles > 0) blockers.push(plural(git.changedFiles, "uncommitted change"));
    if (git.conflicts > 0) blockers.push(plural(git.conflicts, "unresolved conflict"));
    if (git.behind > 0) blockers.push(`behind upstream by ${git.behind}`);
    if (!pr) {
      blockers.push("no pull request open");
    } else if (pr.mergeable === "CONFLICTING") {
      blockers.push("PR has merge conflicts");
    }
    const failing = checks.filter((c) => c.status === "fail").length;
    if (failing > 0) blockers.push(plural(failing, "failing check"));
    const pending = checks.filter((c) => c.status === "pending").length;
    if (pending > 0) blockers.push(`${pending} check${pending === 1 ? "" : "s"} still running`);
    return { ready: blockers.length === 0, blockers };
  }
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
