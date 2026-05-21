import { ConfigLoader } from "./config-loader";
import type { Skill } from "./types";

interface RunParams {
  projectPath: string;
  skillName: string;
  vars: Record<string, string>;
}

export const FREE_TIER_SKILL_CAP = 10;

export interface SkillsEngineOptions {
  loader?: ConfigLoader;
  freeTierCap?: number;
}

export class SkillsEngine {
  private loader: ConfigLoader;
  private cap: number;

  constructor(opts: SkillsEngineOptions = {}) {
    this.loader = opts.loader ?? new ConfigLoader();
    this.cap = opts.freeTierCap ?? FREE_TIER_SKILL_CAP;
  }

  list(projectPath: string): Skill[] {
    const config = this.loader.load(projectPath);
    const skills = config.skills ?? [];
    return skills.slice(0, this.cap);
  }

  run(params: RunParams): { prompt: string; backend?: string } {
    const skills = this.list(params.projectPath);
    const skill = skills.find((s) => s.name === params.skillName);
    if (!skill) throw new Error(`Skill not found: ${params.skillName}`);
    const prompt = this.interpolate(skill.prompt, params.vars);
    return { prompt, backend: skill.backend };
  }

  interpolate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
  }
}
