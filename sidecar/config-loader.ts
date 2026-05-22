import { readFileSync, existsSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { z } from "zod";
import type { MaverickConfig } from "./types";
import { ProjectSettingsSchema } from "./project-settings";

const BackendDefSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).default([]),
});

const SkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  prompt: z.string(),
  backend: z.string().optional(),
});

const PresetNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal("terminal"),
      agent: z.string(),
      cwd: z.string(),
      startup: z.string().optional(),
      mode: z.enum(["agent", "terminal"]),
    }),
    z.object({
      type: z.literal("browser"),
      url: z.string().optional(),
    }),
    z.object({
      type: z.literal("split"),
      direction: z.enum(["h", "v"]),
      ratio: z.number(),
      top: PresetNodeSchema,
      bottom: PresetNodeSchema,
    }),
    z.object({
      type: z.literal("split"),
      direction: z.enum(["h", "v"]),
      ratio: z.number(),
      left: PresetNodeSchema,
      right: PresetNodeSchema,
    }),
  ])
);

const PresetSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  baseBranch: z.string().optional(),
  layout: PresetNodeSchema,
});

const AutomationStepSchema = z
  .object({
    type: z.enum(["shell", "skill", "git", "workspace", "notify", "url"]),
  })
  .passthrough();

const AutomationSchema = z.object({
  name: z.string(),
  trigger: z.enum(["manual", "schedule", "on-file-change"]),
  steps: z.array(AutomationStepSchema),
});

const MCPSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
});

export const MaverickConfigSchema = z.object({
  version: z.number(),
  backends: z.object({
    default: z.string(),
    available: z.array(BackendDefSchema),
  }),
  worktrees: z.object({ base: z.string() }).optional(),
  skills: z.array(SkillSchema).optional(),
  presets: z.array(PresetSchema).optional(),
  automations: z.array(AutomationSchema).optional(),
  mcps: z.array(MCPSchema).optional(),
  project: ProjectSettingsSchema.optional(),
});

export interface ConfigLoaderOptions {
  read?: (path: string) => string;
  exists?: (path: string) => boolean;
}

export class ConfigLoader {
  private read: (path: string) => string;
  private exists: (path: string) => boolean;

  constructor(opts: ConfigLoaderOptions = {}) {
    this.read = opts.read ?? ((p) => readFileSync(p, "utf8"));
    this.exists = opts.exists ?? ((p) => existsSync(p));
  }

  load(projectPath: string): MaverickConfig {
    const yamlPath = join(projectPath, "maverick.yaml");
    const jsonPath = join(projectPath, "maverick.json");
    let raw: unknown;
    if (this.exists(yamlPath)) {
      raw = yaml.load(this.read(yamlPath));
    } else if (this.exists(jsonPath)) {
      raw = JSON.parse(this.read(jsonPath));
    } else {
      throw new Error(`maverick.yaml not found at ${projectPath}`);
    }
    return MaverickConfigSchema.parse(raw) as unknown as MaverickConfig;
  }
}
