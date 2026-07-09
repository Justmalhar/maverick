# Agent Mode — Provider-Agnostic Chat UI

**Date:** 2026-07-02
**Status:** Design approved pending final user review
**Branch:** `feature/agent-ui`

## Summary

A new **Agent Mode** for workspaces: instead of a terminal running an interactive CLI, the workspace renders a chat UI (Conductor-style) that talks to AI coding CLIs through a provider-agnostic event protocol. Mode is chosen at worktree creation (Terminal | Agent). v1 ships the full UI framework plus one real reference adapter (Claude Code via `--input-format stream-json --output-format stream-json`). Codex/Gemini become thin adapters later with zero UI changes.

Also in scope: **workspace-scoped EditorTabs** — the tab strip shows only tabs relevant to the active workspace.

## Decisions made (with user)

| Question | Decision |
|---|---|
| v1 backend depth | UI framework + Claude reference adapter |
| Permissions | `--permission-mode bypassPermissions` in v1; event schema reserves `permission-request` for approval cards later |
| Chat vs terminal | Chat is the workspace's primary editor content; terminal-group tabs remain available in the same workspace |
| Composer scope | Model switcher, reasoning switcher, /slash menu, @file mentions, whole-input drop zone + paste attachments, queued messages, checkpoint/rewind. No voice in v1 |
| Rewind semantics | Files + conversation: git snapshot per user turn, restore worktree AND truncate/fork the provider session |
| Architecture | **A** — sidecar-owned provider adapters normalizing to a unified `AgentEvent` stream |
| Tab scoping | Show only the active workspace's tab + its group/file tabs (user was AFK — chosen per recommendation; veto on review if wrong) |

## Non-goals (v1)

- Permission approval cards (schema reserves the event type)
- Voice/mic input
- Codex/Gemini adapters (interface designed for them; not implemented)
- Token/cost meters in StatusBar
- Cross-session search, transcript export

## Architecture

```
React (src/)                     Rust (src-tauri/)         Bun Sidecar (sidecar/)
┌──────────────────┐  invoke    ┌────────────────┐ stdio  ┌─────────────────────────┐
│ AgentChatView    │──agent_*──▶│ commands/       │──rpc──▶│ agent/session-manager   │
│ agent-store      │            │ agent.rs (thin) │        │ agent/providers/claude  │
│ (zustand)        │◀─listen────│ event forward   │◀─emit──│ agent/checkpoints       │
│  "agent:event"   │            └────────────────┘        │ Bun.spawn (pipes, no PTY)│
└──────────────────┘                                       └───────────┬─────────────┘
                                                                claude --output-format
                                                                stream-json … (cwd=worktree)
```

- **Sidecar owns CLIs** (layer rule): spawns the provider process per session with piped stdin/stdout (no PTY), parses its native NDJSON, and translates to unified `AgentEvent`s.
- **Rust stays a pass-through**: new `commands/agent.rs` mirrors existing per-field-typed command style; sidecar-originated `agent:event` is forwarded like `pty:data`.
- **React renders only unified events.** No provider-specific JSON crosses `src/lib/ipc.ts`. Adding a provider = one adapter file in `sidecar/agent/providers/`.

## Unified protocol

Types live in `src/lib/ipc.ts` and `sidecar/types.ts` (mirrored, per layer rules).

```ts
type AgentPart =
  | { type: "text"; text: string }
  | { type: "thinking"; summary: string; text?: string }
  | { type: "tool-call"; toolUseId: string; toolName: string; title: string;
      detail?: string;                    // e.g. the shell command, file path
      status: "running" | "ok" | "error";
      output?: string;                    // truncated result preview
      fileChanges?: FileChange[]; durationMs?: number }
  | { type: "attachment"; name: string; path: string; mime: string };

interface FileChange { path: string; additions: number; deletions: number;
  kind: "edit" | "create" | "delete" }

interface AgentMessage { id: string; sessionId: string; turnId: string;
  role: "user" | "assistant" | "system"; parts: AgentPart[]; createdAt: number }

type AgentEvent =
  | { type: "session-meta"; providerSessionId: string; model: string }
  | { type: "message-start"; message: AgentMessage }
  | { type: "part-start"; messageId: string; partIndex: number; part: AgentPart }
  | { type: "part-delta"; messageId: string; partIndex: number; delta: string }
  | { type: "part-end"; messageId: string; partIndex: number; part: AgentPart }
  | { type: "message-end"; messageId: string }
  | { type: "turn-end"; turnId: string;
      usage: { inputTokens: number; outputTokens: number; costUsd?: number; durationMs: number } }
  | { type: "status"; status: "idle" | "working" | "attention" | "error" }
  | { type: "queue-updated"; queue: QueuedMessage[] }
  | { type: "permission-request"; /* reserved for v2 approval cards */ requestId: string }
  | { type: "error"; message: string; recoverable: boolean };
```

Tauri event channel: `agent:event` with payload `{ workspaceId, sessionId, event }` — same shape discipline as `pty:data`.

### Adapter interface (sidecar)

```ts
interface AgentProviderAdapter {
  id: AgentBackendId;                       // "claude" | "codex" | …
  capabilities(): Promise<AgentCapabilities>; // models, reasoningLevels,
                                              // slashCommands, supportsInterrupt,
                                              // supportsConversationRewind
  buildSpawn(opts: SpawnOpts): { cmd: string[]; env?: Record<string,string> };
  translate(line: string, ctx: TurnContext): AgentEvent[];  // one NDJSON line in,
                                                            // zero+ unified events out
  encodeUserMessage(parts: AgentPart[]): string;            // NDJSON line for stdin
  encodeInterrupt?(): string;               // control_request line, else SIGINT
}
```

### Claude reference adapter

- Spawn: `claude --input-format stream-json --output-format stream-json --verbose --include-partial-messages --permission-mode bypassPermissions --max-turns 1000 --model <id> [--effort <level>] [--resume <providerSessionId>]`, `cwd` = worktree, PATH via existing `repairToolPath()`.
- Long-lived process per session; multi-turn over stdin. Model/reasoning change: attempt `control_request` (`set_model`); fallback = graceful respawn with `--resume` on next send.
- Interrupt: `control_request { subtype: "interrupt" }`; hard fallback SIGINT then SIGKILL after grace.
- Translation: `system/init` → `session-meta`; `stream_event` text/thinking deltas → `part-delta`; `assistant` content blocks (`tool_use`) → `part-start` tool-call; `user` tool_result → `part-end` with output + file-change extraction (Edit/Write/MultiEdit inputs give path + diff stats); `result` → `turn-end` with usage/cost.
- Model list + reasoning levels come from `capabilities()`; defaults seeded from existing `models.claude.id` settings key.

## Data model (SQLite, sidecar)

Migration `006_agent_mode.sql` (runner applies once by filename; follow existing style):

```sql
ALTER TABLE workspaces ADD COLUMN mode TEXT NOT NULL DEFAULT 'terminal';
ALTER TABLE sessions ADD COLUMN provider_session_id TEXT;
ALTER TABLE sessions ADD COLUMN model TEXT;
ALTER TABLE sessions ADD COLUMN reasoning_level TEXT;
ALTER TABLE messages ADD COLUMN parts_json TEXT;   -- serialized AgentPart[]
ALTER TABLE messages ADD COLUMN turn_id TEXT;
CREATE TABLE IF NOT EXISTS agent_checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,          -- the user message this precedes
  git_sha TEXT NOT NULL,             -- snapshot commit (hidden ref)
  provider_session_id TEXT,
  created_at INTEGER NOT NULL
);
```

- `sessions`/`messages` tables already exist (001_initial) with an auto-created session per workspace — reused, not rebuilt.
- Persistence policy: finalized `AgentMessage` records are written on `message-end` (deltas are never persisted). Transcript rehydrates from `messages.list` + parts_json; an in-flight turn at app restart is marked interrupted.

## Checkpoints & rewind

- **Snapshot** (before each user turn): in the worktree, write the full tree without touching HEAD/index — `git add -A` into a temp index + `git write-tree` + `git commit-tree`, stored on hidden ref `refs/maverick/checkpoints/<sessionId>`. No branch movement, invisible to the user's git status.
- **Rewind to message M**: kill/park the provider process → `git restore --source=<sha> --staged --worktree :/` + `git clean -fd` (scoped to worktree) → delete messages after M and their checkpoints → fork the provider conversation.
- **Conversation fork (Claude)**: preferred mechanism is truncating a copy of the provider session transcript (`~/.claude/projects/<hash>/<sessionId>.jsonl`) to the checkpoint's turn and resuming the copy under a new session id. This is version-coupled — **implementation must verify against the installed CLI**; if infeasible, fallback is files-only rewind + transcript truncation + a fresh provider session (adapter reports `supportsConversationRewind: false` and the UI labels the action "Restore files").
- Checkpoint GC: pruned when a session/workspace is destroyed (hook into existing `teardownWorkspace`).

## Sidecar surface (RPC methods)

| Method | Purpose |
|---|---|
| `agent.capabilities { backend }` | models, reasoning levels, slash commands, feature flags |
| `agent.send { sessionId, parts }` | checkpoint → encode → write stdin; spawns process lazily on first send; if a turn is active, enqueues and emits `queue-updated`. Model/reasoning always come from session options (set via `agent.setOptions`) |
| `agent.interrupt { sessionId }` | stop current turn (queue preserved) |
| `agent.queueRemove { sessionId, queuedId }` | remove a queued message |
| `agent.rewind { sessionId, checkpointId }` | restore + truncate + fork as above |
| `agent.setOptions { sessionId, model?, reasoningLevel? }` | takes effect next turn |
| `agent.state { workspaceId }` | status, queue, options, providerSessionId — for rehydrate |

Queue lives sidecar-side so it survives UI reloads. Existing `messages.list` RPC serves transcript history.

## Frontend

### New zone: `src/components/agent/**` (Editor/Terminal agent ownership) + `src/state/agent-store.ts`

| Component | Responsibility |
|---|---|
| `AgentChatView` | Root per agent workspace; keep-alive under `WorkspaceEditor`; scroll container + "Scroll to bottom" pill |
| `Transcript` | Virtualized message list (react-virtuoso, ~16KB gz — justified in PR per budget rule; lists routinely exceed the 50-item virtualization threshold) |
| `UserMessage` | Right-aligned bubble, attachment chips, hover ⋯ menu with **Rewind to here** |
| `AssistantTurn` | Renders parts in order; markdown via existing `react-markdown` + `remark-gfm` (+ shiki for code blocks) |
| `ThinkingRow` | Collapsed one-line summary, expandable |
| `ToolCallGroup` | Collapses consecutive tool parts: "N tool calls, M messages" expander (screenshot behavior); rows show icon, title, detail chip |
| `FileChangeChip` | `path +N −N`; click opens the file via existing viewer tabs; hover shows a lightweight patch preview (styled `<pre>`, not Monaco) |
| `TurnFooter` | Duration, copy, file chips summary |
| `Composer` | Auto-grow textarea; whole surface a drop target via `registerFileDropTarget` (`src/lib/file-drop.ts` — Tauri swallows DOM drops); paste-to-attach (long text becomes a `pasted_text_*.txt` attachment) |
| `ModelMenu` / `ReasoningMenu` | Footer dropdowns fed by `agent.capabilities`; persist per-session via `agent.setOptions` |
| `SlashMenu` / `MentionMenu` | shadcn `command` in a popover (add `popover` primitive via `bunx shadcn add popover`); `/` at start-of-input lists provider slash commands; `@` lists worktree files (same fs source as QuickOpen/FilesView); inserts token text |
| `QueueRow` | Queued messages under the transcript with remove buttons |

- Attachments stored under `~/.maverick/attachments/<sessionId>/`; images sent as base64 content blocks, other files referenced by path in the message text.
- **Streaming perf:** single global `agent:event` listener dispatches to the store; `part-delta` appends are RAF-coalesced (16ms window, same rule as PTY writes). Framer Motion for message-in/expand animations with `useReducedMotion` guard.
- **Status integration:** `status` events feed the existing `useAgentStatusStore`, so StatusBar pills, NotificationBell, and OS notifications (attention/error) work unchanged.
- Send button ↔ Stop button reflects turn state; Esc also interrupts when composer is focused.

### Workspace creation & rendering

- `NewWorkspaceDialog`: segmented control **Terminal | Agent** (default Terminal); `mode` added to `NewWorkspacePayload`, threaded through `workspaceCreate` → Rust → `workspace.create` → `sqlite-store.workspaceCreate` → `Workspace` type in `ipc.ts`/`sidecar/types.ts`.
- `ProjectsView.onAddWorkspace`: skips `setLaunchSpec` for agent workspaces (no shell auto-launch); AI-rename flow unchanged.
- `WorkspaceEditor.tsx:37`: branches on `workspace.mode` — `agent` renders `AgentChatView` as the workspace-primary content; terminal-group tabs continue to work in the same workspace (a new group renders `TerminalView` exactly as today).
- Existing workspaces (no column value) default to `terminal` — zero behavior change.

## Workspace-scoped EditorTabs

`EditorTabs.tsx:185-194` currently renders every open workspace as a tab. Change: render only the workspace matching `contextWorkspaceId` (already computed at line 98). System tabs, the active workspace's terminal-group tabs, and its file tabs are already scoped and stay as-is. Other workspaces are reached via the PrimarySideBar project tree (status pills already shown there). LRU/keep-alive mounting in `EditorGroup` is untouched — hidden ≠ closed; `⌘W` handler unchanged. *(Chosen per recommendation while user was AFK — flag on review to switch to "no workspace tab at all" or a setting.)*

## Error handling

- **Process crash / non-zero exit:** `error` event → transcript error row with a Retry affordance (re-sends the last user message with `--resume`); status → `error`.
- **Unparseable NDJSON line:** adapter logs and emits nothing; a counter surfaces "N unrecognized events" in the turn footer rather than corrupting the transcript.
- **Send while dead:** `agent.send` respawns with `--resume` transparently.
- **App restart mid-turn:** rehydrate marks the dangling turn interrupted; queue (sidecar-side) survives.
- **Rewind failures:** git restore errors abort before message truncation (worktree first, DB second — never truncate history if files failed to restore).

## Testing

- **Sidecar (`bun test`):** adapter `translate()` against recorded real `claude` stream-json fixtures (init, text/thinking deltas, tool_use/tool_result, result, error, version-drift junk lines); session-manager with the existing fake-subprocess factory (spawn/queue/interrupt/respawn); checkpoint create/restore against temp git repos including untracked + deleted files.
- **Frontend (Vitest + RTL, MSW-mocked `invoke`):** transcript reducer (event stream → message list, delta coalescing, out-of-order guards); Composer (slash/mention menus by role, queue-while-working, model menu persistence); rewind flow confirm dialog; `EditorTabs` scoping (other-workspace tabs absent, ⌘W paths intact).
- **Rust (`cargo test`):** agent command pass-throughs with fixture JSON-RPC stream (existing pattern).
- Coverage thresholds per CLAUDE.md; note the `test:coverage` gate is pre-existingly red on main (~80 files) — new code meets thresholds independently.

## Implementation risks (verify during implementation, in order)

1. **Claude conversation-rewind** via session-file fork — most version-coupled piece; fallback defined (files-only).
2. **Slash command execution** under stream-json input — if the CLI doesn't expand custom commands, expand locally in the adapter (read `.claude/commands/*`, interpolate, send as text).
3. **`set_model`/effort mid-session** via control_request — fallback respawn `--resume`.
4. **`--include-partial-messages` event shapes** vary by CLI version — pin a minimum supported version in `capabilities()` and degrade to non-partial (whole-message) rendering below it.
