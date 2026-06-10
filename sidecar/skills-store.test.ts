import { describe, it, expect, beforeEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SkillsStore } from "./skills-store";

function tempDir(): string {
  const dir = join(tmpdir(), `skills-store-test-${Math.floor(Date.now() / 1000)}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("SkillsStore.parse", () => {
  const store = new SkillsStore({ dir: "/tmp" });

  it("parses a valid skill file", () => {
    const content = `---\nname: my-skill\ndescription: Does a thing\n---\n\nPrompt here.`;
    expect(store.parse(content)).toEqual({
      name: "my-skill",
      description: "Does a thing",
      prompt: "Prompt here.",
      backend: undefined,
    });
  });

  it("parses backend field when present", () => {
    const content = `---\nname: foo\ndescription: bar\nbackend: codex\n---\n\nmy prompt`;
    const skill = store.parse(content);
    expect(skill?.backend).toBe("codex");
  });

  it("returns null when frontmatter is missing", () => {
    expect(store.parse("just plain text")).toBeNull();
  });

  it("returns null when name field is absent", () => {
    const content = `---\ndescription: no name here\n---\n\nPrompt`;
    expect(store.parse(content)).toBeNull();
  });

  it("returns null when frontmatter yaml is invalid", () => {
    const content = `---\n: bad: yaml: [\n---\n\nPrompt`;
    expect(store.parse(content)).toBeNull();
  });
});

describe("SkillsStore.list", () => {
  let dir: string;
  let store: SkillsStore;

  beforeEach(() => {
    dir = tempDir();
    store = new SkillsStore({ dir });
  });

  it("returns empty array for an empty directory", () => {
    expect(store.list()).toEqual([]);
  });

  it("lists skills from .md files", () => {
    writeFileSync(join(dir, "alpha.md"), `---\nname: alpha\ndescription: A\n---\n\nprompt a`);
    writeFileSync(join(dir, "beta.md"), `---\nname: beta\ndescription: B\n---\n\nprompt b`);
    const skills = store.list();
    expect(skills).toHaveLength(2);
    expect(skills[0].name).toBe("alpha");
    expect(skills[1].name).toBe("beta");
  });

  it("ignores non-.md files", () => {
    writeFileSync(join(dir, "readme.txt"), "not a skill");
    writeFileSync(join(dir, "skill.md"), `---\nname: ok\ndescription: fine\n---\n\nprompt`);
    expect(store.list()).toHaveLength(1);
  });

  it("skips files with invalid frontmatter", () => {
    writeFileSync(join(dir, "bad.md"), "no frontmatter here");
    writeFileSync(join(dir, "good.md"), `---\nname: good\ndescription: valid\n---\n\nprompt`);
    const skills = store.list();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("good");
  });

  it("creates the skills directory if it does not exist", () => {
    const missing = join(tmpdir(), `skills-missing-${Date.now()}`);
    const s = new SkillsStore({ dir: missing });
    expect(s.list()).toEqual([]);
    rmSync(missing, { recursive: true, force: true });
  });
});

describe("SkillsStore.create", () => {
  let dir: string;
  let store: SkillsStore;

  beforeEach(() => {
    dir = tempDir();
    store = new SkillsStore({ dir });
  });

  it("creates a .md file and the skill appears in list()", () => {
    store.create("Test Skill", "Does testing");
    const skills = store.list();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("Test Skill");
    expect(skills[0].description).toBe("Does testing");
  });

  it("slugifies the name for the filename", () => {
    const filePath = store.create("My Cool Skill!", "desc");
    expect(filePath).toMatch(/my-cool-skill\.md$/);
  });

  it("writes prompt and backend into the file", () => {
    const filePath = store.create("foo", "bar", "do something", "claude-code");
    const skills = store.list();
    expect(skills[0].prompt).toBe("do something");
    expect(skills[0].backend).toBe("claude-code");
    expect(filePath).toMatch(/foo\.md$/);
  });

  it("falls back to 'skill.md' when name slugifies to empty string", () => {
    const filePath = store.create("---", "edge case");
    expect(filePath).toMatch(/skill\.md$/);
  });
});
