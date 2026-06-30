import { describe, test, expect } from "bun:test";
import { BranchNameGenerator } from "./branch-name-generator";
import type { Shell } from "./types";

function fakeShell(result: { stdout?: string; stderr?: string; exitCode?: number }): {
  shell: Shell;
  calls: string[][];
  stdins: (string | undefined)[];
} {
  const calls: string[][] = [];
  const stdins: (string | undefined)[] = [];
  const shell: Shell = {
    text: async () => "",
    run: async (cmd: string[], _cwd?: string, stdin?: string) => {
      calls.push(cmd);
      stdins.push(stdin);
      return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.exitCode ?? 0 };
    },
  };
  return { shell, calls, stdins };
}

describe("BranchNameGenerator", () => {
  test("runs claude -p with the task over stdin and returns the trimmed name", async () => {
    const { shell, calls, stdins } = fakeShell({ stdout: "fix-login-auth\n" });
    const r = await new BranchNameGenerator({ shell }).generate({ prompt: "Fix the login bug" });
    expect(r.name).toBe("fix-login-auth");
    expect(calls[0]).toEqual(["claude", "-p", "--output-format", "text"]);
    expect(stdins[0]).toContain("Fix the login bug");
  });

  test("throws when the CLI exits non-zero", async () => {
    const { shell } = fakeShell({ exitCode: 1, stderr: "not logged in" });
    await expect(new BranchNameGenerator({ shell }).generate({ prompt: "x" })).rejects.toThrow();
  });

  test("throws on empty output", async () => {
    const { shell } = fakeShell({ stdout: "   " });
    await expect(new BranchNameGenerator({ shell }).generate({ prompt: "x" })).rejects.toThrow();
  });

  test("passes branchRename instructions to the model and keeps slash prefixes", async () => {
    const { shell, stdins } = fakeShell({ stdout: "feature/login-page\n" });
    const r = await new BranchNameGenerator({ shell }).generate({
      prompt: "Fix the login page",
      instructions: "always use feature/feature-name convention",
    });
    expect(r.name).toBe("feature/login-page");
    expect(stdins[0]).toContain("always use feature/feature-name convention");
  });

  test("sanitizes messy model output into a git-safe ref", async () => {
    const { shell } = fakeShell({ stdout: "`Feature/Login Page!`\n" });
    const r = await new BranchNameGenerator({ shell }).generate({
      prompt: "x",
      instructions: "feature/<name>",
    });
    expect(r.name).toBe("feature/login-page");
  });

  test("collapses duplicate slashes and trims stray separators", async () => {
    const { shell } = fakeShell({ stdout: "branch: feature//login--page/\n" });
    const r = await new BranchNameGenerator({ shell }).generate({ prompt: "x", instructions: "y" });
    expect(r.name).toBe("feature/login-page");
  });

  test("throws when the model returns a prose sentence (rejected → caller falls back)", async () => {
    // Real failure mode: claude -p returned a whole explanatory sentence, which
    // sanitized to a 100-char garbage slug. sanitizeBranchName must reject it.
    const sentence =
      "This is just a branch name suggestion request, not a task to execute, no skill needed: feature/dashboard-daily-tasks";
    const { shell } = fakeShell({ stdout: sentence });
    await expect(new BranchNameGenerator({ shell }).generate({ prompt: "x" })).rejects.toThrow();
  });

  test("runs the injected agent spec", async () => {
    const { shell, calls } = fakeShell({ stdout: "fix-thing\n" });
    await new BranchNameGenerator({ shell }).generate({
      prompt: "x",
      agent: { command: "gemini", args: [] },
    });
    expect(calls[0]).toEqual(["gemini"]);
  });
});

describe("BranchNameGenerator.generateFromDiff", () => {
  test("names from last commit subject + diff stat, honoring instructions", async () => {
    const texts = ["add login page", " src/login.ts | 10 +++"];
    let ti = 0;
    let stdin: string | undefined;
    const shell: Shell = {
      text: async () => texts[ti++] ?? "",
      run: async (_cmd, _cwd, input) => {
        stdin = input;
        return { stdout: "feature/login-page\n", stderr: "", exitCode: 0 };
      },
    };
    const r = await new BranchNameGenerator({ shell }).generateFromDiff({ cwd: "/w", instructions: "use feature/<name>" });
    expect(r.name).toBe("feature/login-page");
    expect(stdin).toContain("add login page");
    expect(stdin).toContain("use feature/<name>");
  });

  test("falls back to a generic summary when git is quiet", async () => {
    let stdin: string | undefined;
    const shell: Shell = {
      text: async () => "",
      run: async (_cmd, _cwd, input) => {
        stdin = input;
        return { stdout: "tidy-up\n", stderr: "", exitCode: 0 };
      },
    };
    const r = await new BranchNameGenerator({ shell }).generateFromDiff({ cwd: "/w" });
    expect(r.name).toBe("tidy-up");
    expect(stdin).toContain("recent code changes");
  });
});

describe("BranchNameGenerator.sanitizeBranchName — caps", () => {
  test("rejects prose with too many words", () => {
    expect(
      BranchNameGenerator.sanitizeBranchName(
        "this is just a branch name suggestion not a task to execute"
      )
    ).toBe("");
  });
  test("rejects an over-long single token", () => {
    expect(
      BranchNameGenerator.sanitizeBranchName("addanewuserprofilepagewithavataruploadandaccountsettings")
    ).toBe("");
  });
  test("keeps a normal feature/ name", () => {
    expect(BranchNameGenerator.sanitizeBranchName("feature/dashboard-daily-tasks")).toBe(
      "feature/dashboard-daily-tasks"
    );
  });
  test("keeps a 4-word kebab name", () => {
    expect(BranchNameGenerator.sanitizeBranchName("fix-login-redirect-bug")).toBe(
      "fix-login-redirect-bug"
    );
  });
});

describe("BranchNameGenerator.sanitizeBranchName", () => {
  test("lowercases, hyphenates spaces, drops illegal chars", () => {
    expect(BranchNameGenerator.sanitizeBranchName("Add Login Flow!")).toBe("add-login-flow");
  });
  test("keeps a single slash prefix", () => {
    expect(BranchNameGenerator.sanitizeBranchName("fix/auth-bug")).toBe("fix/auth-bug");
  });
  test("returns empty string for separator-only input", () => {
    expect(BranchNameGenerator.sanitizeBranchName("  ///--- ")).toBe("");
  });
});
