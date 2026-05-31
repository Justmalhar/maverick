import { describe, test, expect } from "bun:test";
import { AutomationRunner } from "./automation-runner";
import { ConfigLoader } from "./config-loader";
import { GitModule } from "./git-module";
import { SkillsEngine } from "./skills-engine";
import { NotificationService } from "./notification-service";
import { WorktreeManager } from "./worktree-manager";
import type { AutomationStep, Shell } from "./types";

interface Step { stdout?: string; exitCode?: number; stderr?: string }

function transcript(steps: Step[]): { shell: Shell; calls: string[][] } {
  const calls: string[][] = [];
  let i = 0;
  const shell: Shell = {
    async text(cmd) {
      calls.push(cmd);
      return steps[i++]?.stdout ?? "";
    },
    async run(cmd) {
      calls.push(cmd);
      const s = steps[i++] ?? {};
      return { stdout: s.stdout ?? "", stderr: s.stderr ?? "", exitCode: s.exitCode ?? 0 };
    },
  };
  return { shell, calls };
}

function loaderWith(automations: unknown[], skills: unknown[] = []): ConfigLoader {
  return new ConfigLoader({
    read: () =>
      JSON.stringify({
        version: 1,
        backends: { default: "claude", available: [] },
        automations,
        skills,
      }),
    exists: () => true,
  });
}

describe("AutomationRunner.run", () => {
  test("throws when automation not found", async () => {
    const loader = loaderWith([]);
    await expect(
      new AutomationRunner({ loader }).run({
        projectPath: "/r",
        automationName: "missing",
        worktreePath: "/wt",
      })
    ).rejects.toThrow(/Automation not found/);
  });

  test("executes steps sequentially and reports count", async () => {
    const { shell } = transcript([
      {}, // shell step
      {}, // commit (add)  -- not used since no files
      {}, // commit
      { stdout: "sha\n" }, // rev-parse
    ]);
    const loader = loaderWith([
      {
        name: "do",
        trigger: "manual",
        steps: [
          { type: "shell", command: "echo hi" },
          { type: "git", action: "commit", message: "auto" },
        ],
      },
    ]);
    const r = await new AutomationRunner({ loader, shell }).run({
      projectPath: "/r",
      automationName: "do",
      worktreePath: "/wt",
    });
    expect(r.stepsRun).toBe(2);
  });

  test("emits a running→ok step event per step", async () => {
    const { shell } = transcript([{ exitCode: 0 }]);
    const events: Array<{ stepIndex: number; status: string }> = [];
    const notifier = {
      write(line: string) {
        const msg = JSON.parse(line) as { method: string; params: { stepIndex: number; status: string } };
        if (msg.method === "automation.step") events.push(msg.params);
      },
    };
    const loader = loaderWith([
      { name: "do", trigger: "manual", steps: [{ type: "shell", command: "echo hi" }] },
    ]);
    await new AutomationRunner({ loader, shell, notifier }).run({
      projectPath: "/r",
      automationName: "do",
      worktreePath: "/wt",
    });
    expect(events).toEqual([
      { automation: "do", stepIndex: 0, status: "running" },
      { automation: "do", stepIndex: 0, status: "ok", output: "shell ok" },
    ] as never);
  });

  test("emits a running→error step event then rethrows on failure", async () => {
    const { shell } = transcript([{ exitCode: 2, stderr: "boom" }]);
    const events: Array<{ status: string; output?: string }> = [];
    const notifier = {
      write(line: string) {
        const msg = JSON.parse(line) as { method: string; params: { status: string; output?: string } };
        if (msg.method === "automation.step") events.push(msg.params);
      },
    };
    const loader = loaderWith([
      { name: "do", trigger: "manual", steps: [{ type: "shell", command: "false" }] },
    ]);
    await expect(
      new AutomationRunner({ loader, shell, notifier }).run({
        projectPath: "/r",
        automationName: "do",
        worktreePath: "/wt",
      })
    ).rejects.toThrow(/boom/);
    expect(events[0].status).toBe("running");
    expect(events[1].status).toBe("error");
    expect(events[1].output).toContain("boom");
  });

  test("error path stringifies a non-Error throw", async () => {
    const events: Array<{ status: string; output?: string }> = [];
    const notifier = {
      write(line: string) {
        const msg = JSON.parse(line) as { method: string; params: { status: string; output?: string } };
        if (msg.method === "automation.step") events.push(msg.params);
      },
    };
    const throwingShell: Shell = {
      async text() {
        return "";
      },
      async run() {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "string failure";
      },
    };
    const loader = loaderWith([
      { name: "do", trigger: "manual", steps: [{ type: "shell", command: "x" }] },
    ]);
    await expect(
      new AutomationRunner({ loader, shell: throwingShell, notifier }).run({
        projectPath: "/r",
        automationName: "do",
        worktreePath: "/wt",
      })
    ).rejects.toBe("string failure");
    expect(events[1].output).toBe("string failure");
  });
});

describe("AutomationRunner.executeStep", () => {
  test("shell step succeeds", async () => {
    const { shell, calls } = transcript([{ exitCode: 0 }]);
    await new AutomationRunner({ shell, loader: loaderWith([]) }).executeStep(
      { type: "shell", command: "echo" } as AutomationStep,
      "/wt",
      "/r",
      {}
    );
    expect(calls[0]).toEqual(["sh", "-c", "echo"]);
  });

  test("shell step throws on non-zero exit", async () => {
    const { shell } = transcript([{ exitCode: 1, stderr: "no" }]);
    await expect(
      new AutomationRunner({ shell, loader: loaderWith([]) }).executeStep(
        { type: "shell", command: "false" } as AutomationStep,
        "/wt",
        "/r",
        {}
      )
    ).rejects.toThrow(/no/);
  });

  test("skill step runs SkillsEngine.run (name field)", async () => {
    const loader = loaderWith([], [
      { name: "review", description: "d", prompt: "p {{x}}" },
    ]);
    const skills = new SkillsEngine({ loader });
    await new AutomationRunner({ loader, skills }).executeStep(
      { type: "skill", name: "review" } as AutomationStep,
      "/wt",
      "/r",
      { x: "1" }
    );
  });

  test("skill step accepts the builder's `skill` field", async () => {
    const loader = loaderWith([], [
      { name: "review", description: "d", prompt: "p {{x}}" },
    ]);
    const skills = new SkillsEngine({ loader });
    await new AutomationRunner({ loader, skills }).executeStep(
      { type: "skill", skill: "review" } as AutomationStep,
      "/wt",
      "/r",
      { x: "1" }
    );
  });

  test("git commit action", async () => {
    const { shell } = transcript([{}, { stdout: "sha\n" }]);
    const git = new GitModule({ shell });
    await new AutomationRunner({ git, loader: loaderWith([]) }).executeStep(
      { type: "git", action: "commit", message: "auto" } as AutomationStep,
      "/wt",
      "/r",
      {}
    );
  });

  test("git push action", async () => {
    const { shell } = transcript([{}]);
    const git = new GitModule({ shell });
    await new AutomationRunner({ git, loader: loaderWith([]) }).executeStep(
      { type: "git", action: "push" } as AutomationStep,
      "/wt",
      "/r",
      {}
    );
  });

  test("git pull action", async () => {
    const { shell } = transcript([{}]);
    const git = new GitModule({ shell });
    await new AutomationRunner({ git, loader: loaderWith([]) }).executeStep(
      { type: "git", action: "pull" } as AutomationStep,
      "/wt",
      "/r",
      {}
    );
  });

  test("git unsupported action throws", async () => {
    await expect(
      new AutomationRunner({ loader: loaderWith([]) }).executeStep(
        { type: "git", action: "rebase" } as AutomationStep,
        "/wt",
        "/r",
        {}
      )
    ).rejects.toThrow(/Unsupported git action/);
  });

  test("workspace destroy action", async () => {
    const { shell } = transcript([{}]);
    const worktree = new WorktreeManager({ shell });
    await new AutomationRunner({ worktree, loader: loaderWith([]) }).executeStep(
      { type: "workspace", action: "destroy" } as AutomationStep,
      "/wt",
      "/r",
      {}
    );
  });

  test("workspace unsupported action throws", async () => {
    await expect(
      new AutomationRunner({ loader: loaderWith([]) }).executeStep(
        { type: "workspace", action: "rename" } as AutomationStep,
        "/wt",
        "/r",
        {}
      )
    ).rejects.toThrow(/Unsupported workspace action/);
  });

  test("notify step emits via NotificationService", async () => {
    const lines: string[] = [];
    const svc = new NotificationService({ notifier: { write: (l) => lines.push(l) } });
    await new AutomationRunner({ notifications: svc, loader: loaderWith([]) }).executeStep(
      { type: "notify", title: "T", body: "B" } as AutomationStep,
      "/wt",
      "/r",
      {}
    );
    expect(lines[0]).toContain("notification.send");
  });

  test("url step emits automation.url", async () => {
    const lines: string[] = [];
    await new AutomationRunner({
      loader: loaderWith([]),
      notifier: { write: (l) => lines.push(l) },
    }).executeStep(
      { type: "url", url: "https://x" } as AutomationStep,
      "/wt",
      "/r",
      {}
    );
    expect(lines[0]).toContain("automation.url");
  });

  test("unknown step type throws", async () => {
    await expect(
      new AutomationRunner({ loader: loaderWith([]) }).executeStep(
        { type: "weird" } as unknown as AutomationStep,
        "/wt",
        "/r",
        {}
      )
    ).rejects.toThrow(/Unknown automation step/);
  });

  test("default constructor builds without DI", () => {
    expect(new AutomationRunner()).toBeInstanceOf(AutomationRunner);
  });
});
