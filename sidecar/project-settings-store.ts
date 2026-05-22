import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from "fs";
import { join, isAbsolute, normalize } from "path";
import { ProjectSettingsSchema, applyDefaults, type ProjectSettings } from "./project-settings";

export class ProjectSettingsStore {
  private configPath(projectPath: string): string {
    return join(projectPath, "maverick.json");
  }

  read(projectPath: string): ProjectSettings {
    const path = this.configPath(projectPath);
    if (!existsSync(path)) {
      return applyDefaults(ProjectSettingsSchema.parse({}), projectPath);
    }
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const projectRaw = (raw.project as object | undefined) ?? {};
    return applyDefaults(ProjectSettingsSchema.parse(projectRaw), projectPath);
  }

  write(projectPath: string, patch: Partial<ProjectSettings>): ProjectSettings {
    this.validateFilesToCopy(patch);
    const path = this.configPath(projectPath);
    const existing: Record<string, unknown> = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8"))
      : { version: 1, backends: { default: "claude", available: [] } };

    const currentProject = (existing.project as object | undefined) ?? {};
    const merged = deepMerge(currentProject, patch as Record<string, unknown>);
    const parsed = ProjectSettingsSchema.parse(merged);
    existing.project = parsed;

    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(existing, null, 2), "utf8");
    renameSync(tmp, path);
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* noop */
    }

    return applyDefaults(parsed, projectPath);
  }

  private validateFilesToCopy(patch: Partial<ProjectSettings>): void {
    const ftc = patch.workspaces?.filesToCopy;
    if (!ftc) return;
    for (const p of ftc) {
      if (isAbsolute(p) || normalize(p).startsWith("..")) {
        throw new Error(`filesToCopy entry "${p}" must be a project-relative path`);
      }
    }
  }
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const av = a[k];
    if (v && typeof v === "object" && !Array.isArray(v) && av && typeof av === "object" && !Array.isArray(av)) {
      out[k] = deepMerge(av as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}
