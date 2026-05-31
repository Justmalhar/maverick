import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// Project-local fallback order: a Maverick file wins, then Claude's, then the
// generic agents file. First non-empty match short-circuits the chain.
const PROJECT_CANDIDATES = ["MAVERICK.md", "CLAUDE.md", "AGENTS.md"] as const;

export interface ResolvedInstructions {
  project: string;
  projectSource: string | null;
  global: string;
}

export interface InstructionsResolverOptions {
  readFile?: (path: string) => string;
  exists?: (path: string) => boolean;
  home?: string;
}

function stripHtmlComments(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, "").trim();
}

export class InstructionsResolver {
  private readFile: (path: string) => string;
  private exists: (path: string) => boolean;
  private home: string;

  constructor(opts: InstructionsResolverOptions = {}) {
    this.readFile = opts.readFile ?? ((p) => readFileSync(p, "utf8"));
    this.exists = opts.exists ?? ((p) => existsSync(p));
    this.home = opts.home ?? homedir();
  }

  resolve(params: { worktreePath: string }): ResolvedInstructions {
    let project = "";
    let projectSource: string | null = null;
    for (const candidate of PROJECT_CANDIDATES) {
      const path = join(params.worktreePath, candidate);
      if (!this.exists(path)) continue;
      const content = stripHtmlComments(this.readFile(path));
      if (content) {
        project = content;
        projectSource = candidate;
        break;
      }
    }

    let global = "";
    const globalPath = join(this.home, ".maverick", "MAVERICK.md");
    if (this.exists(globalPath)) {
      global = stripHtmlComments(this.readFile(globalPath));
    }

    return { project, projectSource, global };
  }
}
