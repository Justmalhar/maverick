import { describe, it, expect } from "bun:test";
import { ProjectSettingsSchema, applyDefaults } from "./project-settings";

describe("ProjectSettingsSchema", () => {
  it("parses minimal config and fills defaults", () => {
    const parsed = ProjectSettingsSchema.parse({});
    const filled = applyDefaults(parsed, "/tmp/demo");
    expect(filled.name).toBe("demo");
    expect(filled.rootPath).toBe("/tmp/demo");
    expect(filled.workspaces.branchFrom).toBe("origin/main");
    expect(filled.workspaces.filesToCopy).toEqual([]);
    expect(filled.remote).toBe("origin");
    expect(filled.scripts.setup).toBe("");
    expect(filled.scripts.run).toBe("");
    expect(filled.scripts.archive).toBe("");
    expect(filled.preferences.review).toBe("");
  });

  it("preserves provided values", () => {
    const filled = applyDefaults(
      ProjectSettingsSchema.parse({
        name: "alpha",
        scripts: { setup: "bun install" },
        preferences: { general: "be terse" },
      }),
      "/tmp/alpha"
    );
    expect(filled.name).toBe("alpha");
    expect(filled.scripts.setup).toBe("bun install");
    expect(filled.scripts.run).toBe("");
    expect(filled.preferences.general).toBe("be terse");
  });

  it("preserves unknown preference keys", () => {
    const raw = ProjectSettingsSchema.parse({
      preferences: { custom: "extra" },
    });
    expect((raw.preferences as Record<string, string>).custom).toBe("extra");
  });
});
