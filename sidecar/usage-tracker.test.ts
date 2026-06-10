import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { UsageTracker, TRACKED_BACKENDS } from "./usage-tracker";

// Fixed local "now": 2026-06-10 12:00 local time.
const NOW = new Date(2026, 5, 10, 12, 0, 0);
const TODAY_TS = new Date(2026, 5, 10, 9, 30, 0).toISOString();
const YESTERDAY_TS = new Date(2026, 5, 9, 9, 30, 0).toISOString();

let root: string;
let claudeDir: string;
let codexDir: string;

function tracker(): UsageTracker {
  return new UsageTracker({ claudeDir, codexDir, now: () => NOW });
}

function claudeLine(opts: {
  timestamp?: string;
  requestId?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheCreation?: number;
}): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: opts.timestamp ?? TODAY_TS,
    requestId: opts.requestId,
    message: {
      usage: {
        input_tokens: opts.input ?? 0,
        output_tokens: opts.output ?? 0,
        cache_read_input_tokens: opts.cacheRead ?? 0,
        cache_creation_input_tokens: opts.cacheCreation ?? 0,
      },
    },
  });
}

function codexLine(opts: {
  timestamp?: string;
  input?: number;
  cached?: number;
  output?: number;
  total?: number;
}): string {
  return JSON.stringify({
    type: "event_msg",
    timestamp: opts.timestamp ?? TODAY_TS,
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: opts.input ?? 0,
          cached_input_tokens: opts.cached ?? 0,
          output_tokens: opts.output ?? 0,
          total_tokens: opts.total ?? (opts.input ?? 0) + (opts.output ?? 0),
        },
      },
    },
  });
}

function writeClaudeSession(project: string, name: string, lines: string[]): string {
  const dir = join(claudeDir, project);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, lines.join("\n") + "\n");
  return path;
}

function writeCodexRollout(day: Date, name: string, lines: string[]): string {
  const dir = join(
    codexDir,
    String(day.getFullYear()),
    String(day.getMonth() + 1).padStart(2, "0"),
    String(day.getDate()).padStart(2, "0")
  );
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, lines.join("\n") + "\n");
  return path;
}

function rowFor(backend: string) {
  const row = tracker().summary().backends.find((b) => b.backend === backend);
  if (!row) throw new Error(`no row for ${backend}`);
  return row;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mvk-usage-"));
  claudeDir = join(root, "claude");
  codexDir = join(root, "codex");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("UsageTracker.summary", () => {
  test("returns all tracked backends with zeros when no logs exist", () => {
    const s = tracker().summary();
    expect(s.date).toBe("2026-06-10");
    expect(s.backends.map((b) => b.backend)).toEqual([...TRACKED_BACKENDS]);
    for (const b of s.backends) {
      expect(b.totalTokens).toBe(0);
      expect(b.sessions).toBe(0);
    }
  });

  test("aggregates today's claude usage across projects and sessions", () => {
    writeClaudeSession("proj-a", "s1.jsonl", [
      claudeLine({ requestId: "r1", input: 100, output: 50 }),
      claudeLine({ requestId: "r2", input: 10, output: 5, cacheRead: 200, cacheCreation: 30 }),
    ]);
    writeClaudeSession("proj-b", "s2.jsonl", [
      claudeLine({ requestId: "r3", input: 1, output: 2 }),
    ]);
    const row = rowFor("claude-code");
    expect(row.inputTokens).toBe(111);
    expect(row.outputTokens).toBe(57);
    expect(row.cacheReadTokens).toBe(200);
    expect(row.cacheCreationTokens).toBe(30);
    expect(row.totalTokens).toBe(398);
    expect(row.sessions).toBe(2);
  });

  test("dedupes claude turns replayed across resumed sessions by requestId", () => {
    writeClaudeSession("proj", "original.jsonl", [
      claudeLine({ requestId: "dup", input: 100, output: 100 }),
    ]);
    writeClaudeSession("proj", "resumed.jsonl", [
      claudeLine({ requestId: "dup", input: 100, output: 100 }),
      claudeLine({ requestId: "fresh", input: 7, output: 3 }),
    ]);
    const row = rowFor("claude-code");
    expect(row.totalTokens).toBe(210);
    expect(row.sessions).toBe(2);
  });

  test("counts claude turns without a requestId instead of dropping them", () => {
    writeClaudeSession("proj", "s.jsonl", [
      claudeLine({ input: 5, output: 5 }),
      claudeLine({ input: 5, output: 5 }),
    ]);
    expect(rowFor("claude-code").totalTokens).toBe(20);
  });

  test("ignores claude entries from other days and files untouched today", () => {
    writeClaudeSession("proj", "mixed.jsonl", [
      claudeLine({ requestId: "old", timestamp: YESTERDAY_TS, input: 999, output: 999 }),
      claudeLine({ requestId: "new", input: 10, output: 10 }),
    ]);
    const stale = writeClaudeSession("proj", "stale.jsonl", [
      claudeLine({ requestId: "stale", input: 500, output: 500 }),
    ]);
    // mtime predates today → file is skipped entirely without reading it.
    const past = new Date(2026, 5, 8);
    utimesSync(stale, past, past);
    const row = rowFor("claude-code");
    expect(row.totalTokens).toBe(20);
    expect(row.sessions).toBe(1);
  });

  test("skips malformed claude lines and non-usage entries", () => {
    writeClaudeSession("proj", "s.jsonl", [
      "not json at all",
      JSON.stringify({ type: "user", timestamp: TODAY_TS }),
      JSON.stringify({ type: "assistant", timestamp: TODAY_TS, message: "string-message" }),
      JSON.stringify({ type: "assistant", timestamp: TODAY_TS, message: { usage: null } }),
      JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 9 } } }),
      JSON.stringify([1, 2, 3]),
      claudeLine({ requestId: "ok", input: 4, output: 6 }),
    ]);
    const row = rowFor("claude-code");
    expect(row.totalTokens).toBe(10);
    expect(row.sessions).toBe(1);
  });

  test("uses only the last cumulative codex token_count per rollout", () => {
    writeCodexRollout(NOW, "rollout-a.jsonl", [
      codexLine({ input: 100, cached: 20, output: 10, total: 110 }),
      codexLine({ input: 300, cached: 50, output: 40, total: 340 }),
    ]);
    writeCodexRollout(NOW, "rollout-b.jsonl", [
      codexLine({ input: 10, cached: 0, output: 5, total: 15 }),
    ]);
    const row = rowFor("codex");
    expect(row.inputTokens).toBe(260); // 250 + 10 (cached subtracted)
    expect(row.cacheReadTokens).toBe(50);
    expect(row.outputTokens).toBe(45);
    expect(row.totalTokens).toBe(355);
    expect(row.sessions).toBe(2);
  });

  test("attributes a midnight-spanning codex session to today via yesterday's dir", () => {
    const yesterday = new Date(2026, 5, 9);
    writeCodexRollout(yesterday, "rollout-span.jsonl", [
      codexLine({ timestamp: YESTERDAY_TS, input: 50, output: 50, total: 100 }),
      codexLine({ input: 80, output: 20, total: 100 }),
    ]);
    writeCodexRollout(yesterday, "rollout-done-yesterday.jsonl", [
      codexLine({ timestamp: YESTERDAY_TS, input: 500, output: 500, total: 1000 }),
    ]);
    const row = rowFor("codex");
    expect(row.totalTokens).toBe(100);
    expect(row.sessions).toBe(1);
  });

  test("skips malformed codex lines and clamps cached above input", () => {
    writeCodexRollout(NOW, "rollout-x.jsonl", [
      "garbage",
      JSON.stringify({ type: "event_msg", timestamp: TODAY_TS, payload: { type: "agent_message" } }),
      JSON.stringify({ type: "event_msg", timestamp: TODAY_TS, payload: { type: "token_count", info: null } }),
      JSON.stringify({ type: "event_msg", timestamp: TODAY_TS, payload: { type: "token_count", info: { total_token_usage: null } } }),
      JSON.stringify({ type: "event_msg", timestamp: TODAY_TS, payload: null }),
      codexLine({ input: 10, cached: 50, output: 5, total: 15 }),
    ]);
    const row = rowFor("codex");
    // cached_input_tokens can never exceed input_tokens; clamp defensively.
    expect(row.cacheReadTokens).toBe(10);
    expect(row.inputTokens).toBe(0);
    expect(row.totalTokens).toBe(15);
  });

  test("falls back to input+output when codex total_tokens is missing", () => {
    writeCodexRollout(NOW, "rollout-no-total.jsonl", [
      JSON.stringify({
        type: "event_msg",
        timestamp: TODAY_TS,
        payload: {
          type: "token_count",
          info: { total_token_usage: { input_tokens: 30, output_tokens: 12 } },
        },
      }),
    ]);
    expect(rowFor("codex").totalTokens).toBe(42);
  });

  test("antigravity always reports zeros until it exposes local logs", () => {
    const row = rowFor("antigravity");
    expect(row.totalTokens).toBe(0);
    expect(row.sessions).toBe(0);
  });

  test("treats negative and non-numeric token counts as zero", () => {
    writeClaudeSession("proj", "s.jsonl", [
      JSON.stringify({
        type: "assistant",
        timestamp: TODAY_TS,
        message: { usage: { input_tokens: -5, output_tokens: "many" } },
      }),
    ]);
    const row = rowFor("claude-code");
    expect(row.totalTokens).toBe(0);
    // The line still parses as a usage entry, so the session is counted.
    expect(row.sessions).toBe(1);
  });

  test("defaults log roots under the home directory", () => {
    const t = new UsageTracker({ now: () => NOW });
    // Smoke test against the real home dir: must not throw and must keep shape.
    const s = t.summary();
    expect(s.backends).toHaveLength(TRACKED_BACKENDS.length);
  });
});
