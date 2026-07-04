import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { claudeProjectDir, sessionFileLineCount, forkSessionFile } from "./claude-session-file";

let home: string;
const WT = "/Users/me/proj/wt-1";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "mvck-home-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function seedSession(id: string, lines: string[]): string {
  const dir = claudeProjectDir(WT, home);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${id}.jsonl`);
  writeFileSync(p, lines.join("\n") + "\n");
  return p;
}

describe("claude session files", () => {
  test("claudeProjectDir slugs the worktree path", () => {
    expect(claudeProjectDir(WT, home)).toBe(join(home, ".claude", "projects", "-Users-me-proj-wt-1"));
  });

  test("sessionFileLineCount counts non-empty lines; 0 when missing", () => {
    expect(sessionFileLineCount(WT, "nope", home)).toBe(0);
    seedSession("s1", [JSON.stringify({ sessionId: "s1", a: 1 }), JSON.stringify({ sessionId: "s1", a: 2 })]);
    expect(sessionFileLineCount(WT, "s1", home)).toBe(2);
  });

  test("forkSessionFile writes a truncated copy with rewritten sessionId", () => {
    seedSession("s1", [
      JSON.stringify({ sessionId: "s1", turn: 1 }),
      JSON.stringify({ sessionId: "s1", turn: 2 }),
      JSON.stringify({ sessionId: "s1", turn: 3 }),
    ]);
    expect(forkSessionFile(WT, "s1", 2, "fork1", home)).toBe(true);
    const forked = readFileSync(join(claudeProjectDir(WT, home), "fork1.jsonl"), "utf8").trim().split("\n");
    expect(forked).toHaveLength(2);
    expect(forked.map((l) => JSON.parse(l))).toEqual([
      { sessionId: "fork1", turn: 1 },
      { sessionId: "fork1", turn: 2 },
    ]);
  });

  test("forkSessionFile returns false when source is missing or lineCount is 0", () => {
    expect(forkSessionFile(WT, "ghost", 3, "f", home)).toBe(false);
    seedSession("s2", [JSON.stringify({ sessionId: "s2" })]);
    expect(forkSessionFile(WT, "s2", 0, "f2", home)).toBe(false);
    expect(existsSync(join(claudeProjectDir(WT, home), "f2.jsonl"))).toBe(false);
  });
});
