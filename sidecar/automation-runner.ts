import { ConfigLoader } from "./config-loader";
import { GitModule } from "./git-module";
import { SkillsEngine } from "./skills-engine";
import { NotificationService } from "./notification-service";
import { WorktreeManager } from "./worktree-manager";
import { defaultShell, emit, stdoutNotifier } from "./deps";
import type { Automation, AutomationStep, Notifier, Shell } from "./types";

interface RunParams {
  projectPath: string;
  automationName: string;
  worktreePath: string;
  vars?: Record<string, string>;
}

export interface AutomationRunnerOptions {
  loader?: ConfigLoader;
  shell?: Shell;
  git?: GitModule;
  skills?: SkillsEngine;
  notifications?: NotificationService;
  worktree?: WorktreeManager;
  notifier?: Notifier;
}

export class AutomationRunner {
  private loader: ConfigLoader;
  private shell: Shell;
  private git: GitModule;
  private skills: SkillsEngine;
  private notifications: NotificationService;
  private worktree: WorktreeManager;
  private notifier: Notifier;

  constructor(opts: AutomationRunnerOptions = {}) {
    this.loader = opts.loader ?? new ConfigLoader();
    this.shell = opts.shell ?? defaultShell;
    this.git = opts.git ?? new GitModule({ shell: this.shell });
    this.skills = opts.skills ?? new SkillsEngine({ loader: this.loader });
    this.notifications = opts.notifications ?? new NotificationService();
    this.worktree = opts.worktree ?? new WorktreeManager({ shell: this.shell });
    this.notifier = opts.notifier ?? stdoutNotifier;
  }

  async run(params: RunParams): Promise<{ ok: true; stepsRun: number }> {
    const config = this.loader.load(params.projectPath);
    const automation = (config.automations ?? []).find((a) => a.name === params.automationName);
    if (!automation) throw new Error(`Automation not found: ${params.automationName}`);
    let stepsRun = 0;
    for (const step of automation.steps) {
      await this.executeStep(step, params.worktreePath, params.projectPath, params.vars ?? {});
      stepsRun++;
    }
    return { ok: true, stepsRun };
  }

  async executeStep(
    step: AutomationStep,
    worktreePath: string,
    projectPath: string,
    vars: Record<string, string>
  ): Promise<void> {
    switch (step.type) {
      case "shell": {
        const command = String(step.command ?? "");
        const { exitCode, stderr } = await this.shell.run(["sh", "-c", command], worktreePath);
        if (exitCode !== 0) throw new Error(stderr || `shell step failed (exit ${exitCode})`);
        return;
      }
      case "skill": {
        const skillName = String(step.name ?? "");
        this.skills.run({ projectPath, skillName, vars });
        return;
      }
      case "git": {
        const action = String(step.action ?? "");
        if (action === "commit") {
          await this.git.commit({ worktreePath, message: String(step.message ?? "automation commit") });
        } else if (action === "push") {
          await this.git.push({ worktreePath });
        } else if (action === "pull") {
          await this.git.pull({ worktreePath });
        } else {
          throw new Error(`Unsupported git action: ${action}`);
        }
        return;
      }
      case "workspace": {
        const action = String(step.action ?? "");
        if (action === "destroy") {
          await this.worktree.destroy({ worktreePath });
        } else {
          throw new Error(`Unsupported workspace action: ${action}`);
        }
        return;
      }
      case "notify": {
        this.notifications.send({
          title: String(step.title ?? ""),
          body: String(step.body ?? ""),
        });
        return;
      }
      case "url": {
        emit(this.notifier, "automation.url", { url: String(step.url ?? "") });
        return;
      }
      default: {
        const t = (step as { type: string }).type;
        throw new Error(`Unknown automation step type: ${t}`);
      }
    }
  }
}
