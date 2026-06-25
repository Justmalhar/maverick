import { describe, test, expect } from "bun:test";
import { ChecksModule } from "./checks-module";
import type { Shell } from "./types";

interface Step {
  stdout?: string;
  exitCode?: number;
  stderr?: string;
  throws?: Error;
}

function transcript(steps: Step[]): { shell: Shell; calls: string[][] } {
  const calls: string[][] = [];
  let i = 0;
  const shell: Shell = {
    async text(cmd) {
      calls.push(cmd);
      const s = steps[i++] ?? {};
      if (s.throws) throw s.throws;
      return s.stdout ?? "";
    },
    async run(cmd) {
      calls.push(cmd);
      const s = steps[i++] ?? {};
      if (s.throws) throw s.throws;
      return { stdout: s.stdout ?? "", stderr: s.stderr ?? "", exitCode: s.exitCode ?? 0 };
    },
  };
  return { shell, calls };
}

// Order of shell calls in ChecksModule.get:
//   0: for-each-ref (branch + ahead/behind)
//   1: status --porcelain (changed files)
//   2: diff --diff-filter=U (conflicts)
//   3: gh pr view --json ...
function steps(over: Partial<Record<0 | 1 | 2 | 3, Step>>): Step[] {
  return [
    over[0] ?? { stdout: "*\trefs/heads/feat\torigin/feat\t" },
    over[1] ?? { stdout: "" },
    over[2] ?? { stdout: "" },
    over[3] ?? { stdout: "", exitCode: 1, stderr: "no pull requests found for branch" },
  ];
}

describe("ChecksModule gh timeout", () => {
  test("passes a kill budget to the gh subprocess", async () => {
    const optsSeen: Array<{ timeoutMs?: number } | undefined> = [];
    const shell: Shell = {
      text: async () => "*\trefs/heads/feat\torigin/feat\t",
      run: async (_cmd, _cwd, _stdin, opts) => {
        optsSeen.push(opts);
        return { stdout: "", stderr: "no pull requests found for branch", exitCode: 1 };
      },
    };
    await new ChecksModule({ shell }).get({ worktreePath: "/wt" });
    expect(optsSeen).toHaveLength(1);
    expect(optsSeen[0]?.timeoutMs).toBe(30_000);
  });

  test("treats a killed gh (exit 124) as unavailable rather than throwing", async () => {
    const shell: Shell = {
      text: async () => "*\trefs/heads/feat\torigin/feat\t",
      run: async () => ({ stdout: "", stderr: "timed out after 30000ms", exitCode: 124 }),
    };
    const report = await new ChecksModule({ shell }).get({ worktreePath: "/wt" });
    expect(report.ghAvailable).toBe(false);
    expect(report.pr).toBeNull();
  });
});

describe("ChecksModule.parseRollup", () => {
  test("CheckRun conclusions map to status", () => {
    const rollup = [
      { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
      { __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "FAILURE" },
      { __typename: "CheckRun", name: "lint", status: "IN_PROGRESS", conclusion: "" },
      { __typename: "CheckRun", name: "skip", status: "COMPLETED", conclusion: "SKIPPED" },
    ];
    expect(ChecksModule.parseRollup(rollup)).toEqual([
      { name: "build", status: "pass" },
      { name: "test", status: "fail" },
      { name: "lint", status: "pending" },
      { name: "skip", status: "neutral" },
    ]);
  });

  test("StatusContext states map to status", () => {
    const rollup = [
      { __typename: "StatusContext", context: "ci/ok", state: "SUCCESS" },
      { __typename: "StatusContext", context: "ci/bad", state: "FAILURE" },
      { __typename: "StatusContext", context: "ci/wait", state: "PENDING" },
      { __typename: "StatusContext", context: "ci/huh", state: "WHATEVER" },
    ];
    expect(ChecksModule.parseRollup(rollup)).toEqual([
      { name: "ci/ok", status: "pass" },
      { name: "ci/bad", status: "fail" },
      { name: "ci/wait", status: "pending" },
      { name: "ci/huh", status: "neutral" },
    ]);
  });

  test("unknown / malformed entries default to a neutral named row", () => {
    expect(ChecksModule.parseRollup([{ foo: "bar" }, null, "nope"])).toEqual([
      { name: "unknown", status: "neutral" },
      { name: "unknown", status: "neutral" },
      { name: "unknown", status: "neutral" },
    ]);
    expect(ChecksModule.parseRollup(undefined)).toEqual([]);
    expect(ChecksModule.parseRollup("not an array" as unknown)).toEqual([]);
  });
});

describe("ChecksModule.get — git section", () => {
  test("parses branch, ahead/behind, changed files, conflicts", async () => {
    const { shell, calls } = transcript(
      steps({
        0: { stdout: "*\trefs/heads/feat\torigin/feat\tahead 2, behind 1" },
        1: { stdout: " M a.ts\n?? b.ts\n M c.ts\n" },
        2: { stdout: "x.ts\ny.ts\n" },
      })
    );
    const report = await new ChecksModule({ shell }).get({ worktreePath: "/w" });
    expect(report.git).toEqual({
      branch: "feat",
      ahead: 2,
      behind: 1,
      changedFiles: 3,
      conflicts: 2,
    });
    expect(calls[0][0]).toBe("git");
    expect(calls[0]).toContain("for-each-ref");
  });

  test("no upstream track yields zero ahead/behind", async () => {
    const { shell } = transcript(steps({ 0: { stdout: "*\trefs/heads/main\t\t" } }));
    const report = await new ChecksModule({ shell }).get({ worktreePath: "/w" });
    expect(report.git.branch).toBe("main");
    expect(report.git.ahead).toBe(0);
    expect(report.git.behind).toBe(0);
  });
});

describe("ChecksModule.get — PR / gh", () => {
  test("happy path: parses PR + normalized checks", async () => {
    const prJson = JSON.stringify({
      number: 7,
      state: "OPEN",
      title: "Add feature",
      url: "https://github.com/o/r/pull/7",
      mergeable: "MERGEABLE",
      statusCheckRollup: [
        { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
      ],
    });
    const { shell, calls } = transcript(steps({ 3: { stdout: prJson, exitCode: 0 } }));
    const report = await new ChecksModule({ shell }).get({ worktreePath: "/w" });
    expect(report.ghAvailable).toBe(true);
    expect(report.pr).toEqual({
      number: 7,
      state: "OPEN",
      title: "Add feature",
      url: "https://github.com/o/r/pull/7",
      mergeable: "MERGEABLE",
    });
    expect(report.checks).toEqual([{ name: "build", status: "pass" }]);
    expect(calls[3].slice(0, 3)).toEqual(["gh", "pr", "view"]);
  });

  test("no PR for branch: ghAvailable true, pr null, no checks", async () => {
    const { shell } = transcript(steps({}));
    const report = await new ChecksModule({ shell }).get({ worktreePath: "/w" });
    expect(report.ghAvailable).toBe(true);
    expect(report.pr).toBeNull();
    expect(report.checks).toEqual([]);
  });

  test("gh unauthenticated: ghAvailable false", async () => {
    const { shell } = transcript(
      steps({ 3: { exitCode: 1, stderr: "gh auth login required: not authenticated" } })
    );
    const report = await new ChecksModule({ shell }).get({ worktreePath: "/w" });
    expect(report.ghAvailable).toBe(false);
    expect(report.pr).toBeNull();
  });

  test("gh not installed (ENOENT): ghAvailable false, no throw", async () => {
    const { shell } = transcript(steps({ 3: { throws: new Error("spawn gh ENOENT") } }));
    const report = await new ChecksModule({ shell }).get({ worktreePath: "/w" });
    expect(report.ghAvailable).toBe(false);
    expect(report.pr).toBeNull();
  });
});

describe("ChecksModule.get — merge readiness", () => {
  test("clean + open PR + passing checks → ready", async () => {
    const prJson = JSON.stringify({
      number: 1,
      state: "OPEN",
      title: "t",
      url: "u",
      mergeable: "MERGEABLE",
      statusCheckRollup: [
        { __typename: "CheckRun", name: "ci", status: "COMPLETED", conclusion: "SUCCESS" },
      ],
    });
    const { shell } = transcript(steps({ 3: { stdout: prJson, exitCode: 0 } }));
    const report = await new ChecksModule({ shell }).get({ worktreePath: "/w" });
    expect(report.merge.ready).toBe(true);
    expect(report.merge.blockers).toEqual([]);
  });

  test("accumulates every blocker", async () => {
    const prJson = JSON.stringify({
      number: 2,
      state: "OPEN",
      title: "t",
      url: "u",
      mergeable: "CONFLICTING",
      statusCheckRollup: [
        { __typename: "CheckRun", name: "ci", status: "COMPLETED", conclusion: "FAILURE" },
        { __typename: "CheckRun", name: "e2e", status: "IN_PROGRESS", conclusion: "" },
      ],
    });
    const { shell } = transcript(
      steps({
        0: { stdout: "*\trefs/heads/feat\torigin/feat\tbehind 3" },
        1: { stdout: " M a.ts\n" },
        2: { stdout: "c.ts\n" },
        3: { stdout: prJson, exitCode: 0 },
      })
    );
    const report = await new ChecksModule({ shell }).get({ worktreePath: "/w" });
    expect(report.merge.ready).toBe(false);
    expect(report.merge.blockers).toEqual([
      "1 uncommitted change",
      "1 unresolved conflict",
      "behind upstream by 3",
      "PR has merge conflicts",
      "1 failing check",
      "1 check still running",
    ]);
  });

  test("no PR open is a blocker", async () => {
    const { shell } = transcript(steps({}));
    const report = await new ChecksModule({ shell }).get({ worktreePath: "/w" });
    expect(report.merge.blockers).toContain("no pull request open");
  });

  test("pluralizes counts", async () => {
    const { shell } = transcript(
      steps({ 1: { stdout: " M a\n M b\n" }, 2: { stdout: "x\ny\n" } })
    );
    const report = await new ChecksModule({ shell }).get({ worktreePath: "/w" });
    expect(report.merge.blockers).toContain("2 uncommitted changes");
    expect(report.merge.blockers).toContain("2 unresolved conflicts");
  });
});
