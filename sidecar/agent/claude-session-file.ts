import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// The claude CLI stores each session as
// ~/.claude/projects/<cwd-slug>/<session-id>.jsonl where the slug replaces
// every non-alphanumeric character of the absolute cwd with "-". This coupling
// has no version check — every function falls back to "no fork" (fresh
// provider session) when the layout or shape doesn't match.
export function claudeProjectDir(worktreePath: string, home: string = homedir()): string {
  const slug = worktreePath.replace(/[^a-zA-Z0-9]/g, "-");
  return join(home, ".claude", "projects", slug);
}

function sessionPath(worktreePath: string, providerSessionId: string, home?: string): string {
  return join(claudeProjectDir(worktreePath, home), `${providerSessionId}.jsonl`);
}

export function sessionFileLineCount(worktreePath: string, providerSessionId: string, home?: string): number {
  const p = sessionPath(worktreePath, providerSessionId, home);
  if (!existsSync(p)) return 0;
  try {
    return readFileSync(p, "utf8").split("\n").filter((l) => l.trim() !== "").length;
  } catch {
    return 0;
  }
}

export function forkSessionFile(
  worktreePath: string,
  providerSessionId: string,
  lineCount: number,
  newId: string,
  home?: string
): boolean {
  if (lineCount <= 0) return false;
  const src = sessionPath(worktreePath, providerSessionId, home);
  if (!existsSync(src)) return false;
  try {
    const lines = readFileSync(src, "utf8").split("\n").filter((l) => l.trim() !== "");
    if (lines.length < lineCount) return false;
    const truncated = lines.slice(0, lineCount).map((l) => {
      try {
        const obj = JSON.parse(l);
        if (typeof obj === "object" && obj !== null && "sessionId" in obj) obj.sessionId = newId;
        return JSON.stringify(obj);
      } catch {
        return l;
      }
    });
    writeFileSync(sessionPath(worktreePath, newId, home), truncated.join("\n") + "\n");
    return true;
  } catch {
    return false;
  }
}
