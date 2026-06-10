import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { BackendTokenUsage, UsageSummary } from "./types";

/** Backends surfaced on the dashboard. Order is display order. */
export const TRACKED_BACKENDS = ["claude-code", "codex", "antigravity"] as const;

export interface UsageTrackerOptions {
  /** Root of Claude Code session logs. Default: ~/.claude/projects */
  claudeDir?: string;
  /** Root of Codex rollout logs. Default: ~/.codex/sessions */
  codexDir?: string;
  /** Clock, injectable for tests. */
  now?: () => Date;
}

interface TokenTally {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  total: number;
  sessions: number;
}

function emptyTally(): TokenTally {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0, sessions: 0 };
}

function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Aggregates today's token consumption per backend by reading each CLI's own
 * session logs — Maverick never talks to provider APIs and never holds keys.
 *
 * - Claude Code appends one JSONL line per assistant turn with the API's real
 *   usage block; resumed sessions can replay lines, so turns dedupe by
 *   requestId.
 * - Codex emits cumulative `token_count` events per rollout file, so only the
 *   last event of each file counts.
 * - Antigravity has no known local usage log; it reports zeros so the
 *   dashboard row still renders.
 */
export class UsageTracker {
  private claudeDir: string;
  private codexDir: string;
  private now: () => Date;

  constructor(opts: UsageTrackerOptions = {}) {
    this.claudeDir = opts.claudeDir ?? join(homedir(), ".claude", "projects");
    this.codexDir = opts.codexDir ?? join(homedir(), ".codex", "sessions");
    this.now = opts.now ?? (() => new Date());
  }

  summary(): UsageSummary {
    const now = this.now();
    const dayStart = startOfLocalDay(now);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const tallies: Record<string, TokenTally> = {
      "claude-code": this.tallyClaude(dayStart, dayEnd),
      codex: this.tallyCodex(dayStart, dayEnd),
      antigravity: emptyTally(),
    };

    const backends: BackendTokenUsage[] = TRACKED_BACKENDS.map((backend) => {
      const t = tallies[backend];
      return {
        backend,
        inputTokens: t.input,
        outputTokens: t.output,
        cacheReadTokens: t.cacheRead,
        cacheCreationTokens: t.cacheCreation,
        totalTokens: t.total,
        sessions: t.sessions,
      };
    });

    return { date: localDateString(now), backends };
  }

  private tallyClaude(dayStart: Date, dayEnd: Date): TokenTally {
    const tally = emptyTally();
    const seenRequests = new Set<string>();
    for (const file of this.claudeSessionFiles(dayStart)) {
      let counted = false;
      for (const line of this.readLines(file)) {
        const entry = parseJson(line);
        if (!entry) continue;
        const usage = claudeUsageFrom(entry, dayStart, dayEnd);
        if (!usage) continue;
        const requestId = (entry as { requestId?: unknown }).requestId;
        if (typeof requestId === "string") {
          if (seenRequests.has(requestId)) continue;
          seenRequests.add(requestId);
        }
        tally.input += usage.input;
        tally.output += usage.output;
        tally.cacheRead += usage.cacheRead;
        tally.cacheCreation += usage.cacheCreation;
        tally.total += usage.input + usage.output + usage.cacheRead + usage.cacheCreation;
        counted = true;
      }
      if (counted) tally.sessions += 1;
    }
    return tally;
  }

  private tallyCodex(dayStart: Date, dayEnd: Date): TokenTally {
    const tally = emptyTally();
    for (const file of this.codexRolloutFiles(dayStart)) {
      let last: CodexTotals | null = null;
      for (const line of this.readLines(file)) {
        const entry = parseJson(line);
        if (!entry) continue;
        const totals = codexTotalsFrom(entry, dayStart, dayEnd);
        if (totals) last = totals;
      }
      if (!last) continue;
      tally.input += last.input - last.cached;
      tally.output += last.output;
      tally.cacheRead += last.cached;
      tally.total += last.total;
      tally.sessions += 1;
    }
    return tally;
  }

  /** Session files touched today — an untouched mtime means no lines today. */
  private claudeSessionFiles(dayStart: Date): string[] {
    const files: string[] = [];
    for (const project of this.listDir(this.claudeDir)) {
      const projectDir = join(this.claudeDir, project);
      for (const name of this.listDir(projectDir)) {
        if (!name.endsWith(".jsonl")) continue;
        const path = join(projectDir, name);
        try {
          if (statSync(path).mtime >= dayStart) files.push(path);
        } catch {
          /* deleted between listing and stat — skip */
        }
      }
    }
    return files;
  }

  /** Rollouts live under YYYY/MM/DD by local date; a session can span
   *  midnight, so yesterday's directory is scanned too and events are
   *  filtered by timestamp. */
  private codexRolloutFiles(dayStart: Date): string[] {
    const days = [new Date(dayStart.getTime() - 24 * 60 * 60 * 1000), dayStart];
    const files: string[] = [];
    for (const day of days) {
      const dir = join(
        this.codexDir,
        String(day.getFullYear()),
        String(day.getMonth() + 1).padStart(2, "0"),
        String(day.getDate()).padStart(2, "0")
      );
      for (const name of this.listDir(dir)) {
        if (name.endsWith(".jsonl")) files.push(join(dir, name));
      }
    }
    return files;
  }

  private listDir(dir: string): string[] {
    try {
      if (!existsSync(dir)) return [];
      return readdirSync(dir);
    } catch {
      return [];
    }
  }

  private readLines(path: string): string[] {
    try {
      return readFileSync(path, "utf8").split("\n");
    } catch {
      return [];
    }
  }
}

function parseJson(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function timestampWithin(value: unknown, dayStart: Date, dayEnd: Date): boolean {
  if (typeof value !== "string") return false;
  const t = new Date(value).getTime();
  return !Number.isNaN(t) && t >= dayStart.getTime() && t < dayEnd.getTime();
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

interface ClaudeUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

function claudeUsageFrom(
  entry: Record<string, unknown>,
  dayStart: Date,
  dayEnd: Date
): ClaudeUsage | null {
  if (entry.type !== "assistant") return null;
  if (!timestampWithin(entry.timestamp, dayStart, dayEnd)) return null;
  const message = entry.message;
  if (typeof message !== "object" || message === null) return null;
  const usage = (message as Record<string, unknown>).usage;
  if (typeof usage !== "object" || usage === null) return null;
  const u = usage as Record<string, unknown>;
  return {
    input: asCount(u.input_tokens),
    output: asCount(u.output_tokens),
    cacheRead: asCount(u.cache_read_input_tokens),
    cacheCreation: asCount(u.cache_creation_input_tokens),
  };
}

interface CodexTotals {
  input: number;
  cached: number;
  output: number;
  total: number;
}

function codexTotalsFrom(
  entry: Record<string, unknown>,
  dayStart: Date,
  dayEnd: Date
): CodexTotals | null {
  if (entry.type !== "event_msg") return null;
  if (!timestampWithin(entry.timestamp, dayStart, dayEnd)) return null;
  const payload = entry.payload;
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (p.type !== "token_count") return null;
  const info = p.info;
  if (typeof info !== "object" || info === null) return null;
  const totals = (info as Record<string, unknown>).total_token_usage;
  if (typeof totals !== "object" || totals === null) return null;
  const t = totals as Record<string, unknown>;
  const input = asCount(t.input_tokens);
  const cached = Math.min(asCount(t.cached_input_tokens), input);
  const output = asCount(t.output_tokens);
  return {
    input,
    cached,
    output,
    total: asCount(t.total_tokens) || input + output,
  };
}
