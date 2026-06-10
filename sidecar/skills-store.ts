import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import yaml from "js-yaml";
import type { Skill } from "./types";

export interface SkillsStoreOptions {
  dir?: string;
}

export class SkillsStore {
  readonly dir: string;

  constructor(opts: SkillsStoreOptions = {}) {
    this.dir = opts.dir ?? join(homedir(), ".maverick", "skills");
  }

  private ensureDir(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  list(): Skill[] {
    this.ensureDir();
    let files: string[];
    try {
      files = readdirSync(this.dir).filter((f) => f.endsWith(".md")).sort();
    } catch {
      return [];
    }
    const skills: Skill[] = [];
    for (const file of files) {
      try {
        const content = readFileSync(join(this.dir, file), "utf8");
        const skill = this.parse(content);
        if (skill) skills.push(skill);
      } catch {
        /* skip unreadable files */
      }
    }
    return skills;
  }

  create(name: string, description: string, prompt = "", backend?: string): string {
    this.ensureDir();
    const slug = name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "skill";
    const filePath = join(this.dir, `${slug}.md`);
    const fm: Record<string, string> = { name, description };
    if (backend) fm.backend = backend;
    const content = `---\n${yaml.dump(fm)}---\n\n${prompt}`;
    writeFileSync(filePath, content, "utf8");
    return filePath;
  }

  // Exposed for tests — parse frontmatter from a raw .md string.
  parse(content: string): Skill | null {
    const match = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
    if (!match) return null;
    try {
      const fm = yaml.load(match[1]) as Record<string, string> | null;
      if (!fm || typeof fm !== "object") return null;
      if (!fm.name) return null;
      return {
        name: fm.name,
        description: fm.description ?? "",
        prompt: match[2].trim(),
        backend: fm.backend,
      };
    } catch {
      return null;
    }
  }
}
