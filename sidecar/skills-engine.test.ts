import { describe, test, expect } from "bun:test";
import { SkillsEngine, FREE_TIER_SKILL_CAP } from "./skills-engine";
import { ConfigLoader } from "./config-loader";

function loaderWithSkills(count: number, names?: string[]): ConfigLoader {
  const skills = Array.from({ length: count }, (_, i) => ({
    name: names?.[i] ?? `skill${i}`,
    description: "d",
    prompt: `prompt for {{file}} on {{branch}}`,
  }));
  return new ConfigLoader({
    read: () =>
      `version: 1\nbackends:\n  default: claude\n  available: []\nskills:\n${skills
        .map((s) => `  - { name: ${s.name}, description: d, prompt: 'prompt for {{file}} on {{branch}}' }`)
        .join("\n")}\n`,
    exists: () => true,
  });
}

describe("SkillsEngine", () => {
  test("list returns skills from config", () => {
    const engine = new SkillsEngine({ loader: loaderWithSkills(2) });
    const skills = engine.list("/p");
    expect(skills).toHaveLength(2);
  });

  test("list applies free-tier cap", () => {
    const engine = new SkillsEngine({ loader: loaderWithSkills(20) });
    expect(engine.list("/p")).toHaveLength(FREE_TIER_SKILL_CAP);
  });

  test("run interpolates variables", () => {
    const engine = new SkillsEngine({ loader: loaderWithSkills(1, ["review"]) });
    const r = engine.run({
      projectPath: "/p",
      skillName: "review",
      vars: { file: "app.ts", branch: "main" },
    });
    expect(r.prompt).toBe("prompt for app.ts on main");
  });

  test("run throws on unknown skill", () => {
    const engine = new SkillsEngine({ loader: loaderWithSkills(1, ["only"]) });
    expect(() =>
      engine.run({ projectPath: "/p", skillName: "nope", vars: {} })
    ).toThrow(/Skill not found/);
  });

  test("interpolate replaces unknown vars with empty", () => {
    const engine = new SkillsEngine({ loader: loaderWithSkills(0) });
    expect(engine.interpolate("{{a}}{{b}}", { a: "X" })).toBe("X");
  });

  test("returns empty list when config has no skills", () => {
    const loader = new ConfigLoader({
      read: () => "version: 1\nbackends:\n  default: c\n  available: []\n",
      exists: () => true,
    });
    expect(new SkillsEngine({ loader }).list("/p")).toEqual([]);
  });

  test("default constructor builds without DI", () => {
    expect(new SkillsEngine()).toBeInstanceOf(SkillsEngine);
  });
});
