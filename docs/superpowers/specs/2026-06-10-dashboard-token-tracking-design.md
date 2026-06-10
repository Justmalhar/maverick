# Dashboard Token Tracking — Design

**Date:** 2026-06-10
**Status:** Approved (autonomous session — decisions documented for review)

## Problem

The Dashboard tab (`UsagePanel`) shows token/cost figures that are always zero
in practice: the only writer of `context_usage` is a 4-chars-per-token estimate
fed from `AgentTerminal` messages, which PTY-driven CLI sessions never produce.

Two display bugs compound it:

1. **Duplicate Claude Code row.** Rows are keyed by `backends.map(b => b.name)`
   (the display label `"Claude Code"`), while per-workspace usage is keyed by
   `ws.agentBackend` (the id `"claude-code"`). Unmatched usage keys are appended
   as extra rows, so both `Claude Code` and `claude-code` render.
2. Rows show raw ids with no brand icons.

## Decision

Read each CLI's **own session logs** (the `ccusage` approach) in the Bun
sidecar, which owns config/file parsing per the layer rules. No API keys, no
network — only local files the CLIs already write.

| Backend | Source | Shape |
|---|---|---|
| `claude-code` | `~/.claude/projects/*/*.jsonl` | `assistant` lines carry `message.usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`) + ISO `timestamp` + `requestId` (dedupe key for resumed sessions) |
| `codex` | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `event_msg` lines with `payload.type === "token_count"`; `payload.info.total_token_usage` is **cumulative per session** — take the last one per file. `cached_input_tokens` is a subset of `input_tokens`. |
| `antigravity` | none known | always zeros, listed so the row renders |

The dashboard shows **only** Claude Code, Codex, Antigravity for now
(`TRACKED_BACKENDS` constant in the sidecar).

### Aggregation semantics

- "Today" = local midnight to midnight, from an injectable `now()`.
- Claude: skip files whose mtime predates today's local midnight (perf); filter
  lines by timestamp; dedupe by `requestId`. `total = input + output +
  cacheRead + cacheCreation`.
- Codex: scan today's and yesterday's date directories (sessions can span
  midnight); a session's cumulative total is attributed to today iff its last
  `token_count` event is today. `input = input_tokens - cached_input_tokens`,
  `cacheRead = cached_input_tokens`, `total = total_tokens`.
- Sessions = count of log files contributing ≥1 usage entry today.
- Malformed lines / missing dirs are skipped silently — the summary degrades to
  zeros, never throws.

### Plumbing

- Sidecar: new `sidecar/usage-tracker.ts` (`UsageTracker.summary()`), RPC
  method `usage.summary` (no params) in `rpc-handlers.ts`.
- Rust: `commands/usage.rs` → `usage_summary` pass-through (serde_json only).
- React: `usageSummary()` in `src/lib/tauri.ts`; `UsageSummary` /
  `BackendTokenUsage` types mirrored in `src/lib/ipc.ts` and
  `sidecar/types.ts`.

```ts
interface BackendTokenUsage {
  backend: string;          // "claude-code" | "codex" | "antigravity"
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  sessions: number;
}
interface UsageSummary { date: string; backends: BackendTokenUsage[] }
```

### UsagePanel changes

- Rows come straight from `summary.backends` — fixed three-row list keyed by
  backend id. This removes the label/id mismatch (the duplicate Claude Code)
  and the per-session `context_usage` aggregation loop.
- Each row renders the `BACKEND_BRAND` icon + label, total tokens today,
  input/output/cache breakdown, sessions, and an estimated cost
  (`estimateCost(totalTokens, backend)` — still clearly labelled an estimate).
- Summary cards: Tokens today / Sessions today / Est. cost, summed over rows.
- Refresh: on mount, on `maverick:context:updated`, and a 30s poll (logs are
  written by external CLIs; nothing pushes events for them).
- The context-window meter is dropped: a "limit" bar against a daily total is
  meaningless. StatusBar's per-session `useContextUsage` is untouched.

## Alternatives considered

- **Parse PTY output for usage lines** — fragile, breaks on every CLI redraw
  format change; rejected.
- **Statusline/OTEL hooks into each CLI** — requires per-CLI config mutation,
  violates "Maverick reads, never writes CLI config"; rejected.
- **Keep estimates, just fix the duplicate** — leaves the headline numbers
  fictional; rejected.

## Testing

- `sidecar/usage-tracker.test.ts`: fixture log trees in temp dirs — today vs
  yesterday filtering, requestId dedupe, codex cumulative-last semantics,
  malformed lines, missing dirs, midnight-spanning codex session.
- `rpc-handlers.test.ts`: `usage.summary` dispatch case.
- `UsagePanel.test.tsx`: rewritten around the `usage_summary` mock — three
  fixed rows, brand labels, dedupe regression (no `claude-code` raw-id row),
  totals, event + interval refresh.
- Rust: pass-through command follows the existing untested-pass-through
  pattern (`context.rs`); covered by cargo build + existing fixture stream.
