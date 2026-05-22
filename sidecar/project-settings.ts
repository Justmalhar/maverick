import { z } from "zod";
import { basename } from "path";

const ScriptsSchema = z
  .object({
    setup: z.string().default(""),
    run: z.string().default(""),
    archive: z.string().default(""),
  })
  .partial()
  .default({});

const WorkspacesSchema = z
  .object({
    basePath: z.string().optional(),
    branchFrom: z.string().default("origin/main"),
    filesToCopy: z.array(z.string()).default([]),
  })
  .partial()
  .default({});

const PreferencesSchema = z.record(z.string(), z.string()).default({});

export const ProjectSettingsSchema = z
  .object({
    name: z.string().optional(),
    rootPath: z.string().optional(),
    workspaces: WorkspacesSchema,
    remote: z.string().default("origin"),
    previewUrl: z.string().default(""),
    scripts: ScriptsSchema,
    preferences: PreferencesSchema,
  })
  .partial()
  .default({});

export type ProjectSettingsRaw = z.infer<typeof ProjectSettingsSchema>;

export interface ProjectSettings {
  name: string;
  rootPath: string;
  workspaces: {
    basePath?: string;
    branchFrom: string;
    filesToCopy: string[];
  };
  remote: string;
  previewUrl: string;
  scripts: { setup: string; run: string; archive: string };
  preferences: Record<string, string>;
}

const KNOWN_PREFERENCE_KEYS = [
  "review",
  "createPr",
  "fixErrors",
  "resolveConflicts",
  "branchRename",
  "general",
] as const;

export function applyDefaults(raw: ProjectSettingsRaw, projectPath: string): ProjectSettings {
  const ws = raw.workspaces ?? {};
  const sc = raw.scripts ?? {};
  const incoming = raw.preferences ?? {};
  const preferences: Record<string, string> = {};
  for (const key of KNOWN_PREFERENCE_KEYS) {
    preferences[key] = "";
  }
  for (const [key, value] of Object.entries(incoming)) {
    preferences[key] = value;
  }
  return {
    name: raw.name ?? basename(projectPath),
    rootPath: raw.rootPath ?? projectPath,
    workspaces: {
      basePath: ws.basePath,
      branchFrom: ws.branchFrom ?? "origin/main",
      filesToCopy: ws.filesToCopy ?? [],
    },
    remote: raw.remote ?? "origin",
    previewUrl: raw.previewUrl ?? "",
    scripts: {
      setup: sc.setup ?? "",
      run: sc.run ?? "",
      archive: sc.archive ?? "",
    },
    preferences,
  };
}
