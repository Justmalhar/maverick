import { readFileSync, existsSync, writeFileSync } from "fs";
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
  write?: (path: string, contents: string) => void;
}

export class ConfigLoader {
  private read: (path: string) => string;
  private exists: (path: string) => boolean;
  private write: (path: string, contents: string) => void;

  constructor(opts: ConfigLoaderOptions = {}) {
    this.read = opts.read ?? ((p) => readFileSync(p, "utf8"));
    this.exists = opts.exists ?? ((p) => existsSync(p));
    this.write = opts.write ?? ((p, c) => writeFileSync(p, c, "utf8"));
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

  // Merge a partial patch into the on-disk config and persist it. Used by
  // panels (e.g. Automations) so edits survive a reload. The patch is shallow
  // over top-level keys (automations/mcps/skills/presets), validated against
  // the full schema, and written back in the file's native format (YAML when a
  // maverick.yaml exists, JSON otherwise).
  save(projectPath: string, patch: Partial<MaverickConfig>): MaverickConfig {
    const yamlPath = join(projectPath, "maverick.yaml");
    const jsonPath = join(projectPath, "maverick.json");
    const useYaml = this.exists(yamlPath) || !this.exists(jsonPath);
    const targetPath = useYaml ? yamlPath : jsonPath;

    let current: Record<string, unknown> = {
      version: 1,
      backends: { default: "claude", available: [] },
    };
    if (this.exists(targetPath)) {
      const text = this.read(targetPath);
      const parsed = useYaml ? yaml.load(text) : JSON.parse(text);
      if (parsed && typeof parsed === "object") current = parsed as Record<string, unknown>;
    }

    const merged = { ...current, ...patch };
    const validated = MaverickConfigSchema.parse(merged) as unknown as MaverickConfig;
    this.write(targetPath, useYaml ? yaml.dump(validated) : JSON.stringify(validated, null, 2));
    return validated;
  }
}
