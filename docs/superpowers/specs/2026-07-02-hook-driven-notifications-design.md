# Hook-Driven Agent Notifications — Design

**Date:** 2026-07-02
**Branch:** `bug/notifications-spam`
**Status:** Proposed (awaiting review)

## Problem

Maverick spams OS notifications even when nothing needs the user's attention.

### Root cause

Agent status — and therefore every notification — is *inferred from raw PTY bytes*, and the inference is structurally wrong:

1. **`attention` fires on any BEL byte.** `src/hooks/useAgentStatus.ts:10` uses
   `ATTENTION_PATTERN = /\x07|\x1b\]9;/`. Every `\x07` (BEL) or OSC-9 in the
   output stream flips the workspace to `attention` (`:80`). Interactive TUIs —
   Claude Code's own UI, readline, spinners, progress redraws, tab-completion —
   emit BEL constantly, not only when blocked on the user. Each
   `working`→`attention` transition raises "Agent needs input".

2. **`attention`/`error` bypass focus routing.** `src/lib/notification-route.ts:16`
   places them in `ALWAYS_OS_TYPES`, so they raise an OS-native banner even while
   the user is focused on and looking at that exact workspace. The false
   positives from (1) cannot be suppressed.

3. **Status oscillates.** BEL→`attention`, next chunk→`working`, next BEL→
   `attention` again → re-notify. One agent turn produces many banners. `done`
   additionally fires on every clean PTY exit.

**The architecture cannot distinguish "the TUI rang a bell" from "the agent is
genuinely blocked on the user."** No amount of pattern tuning fixes that. The
correct signal source is each CLI's own lifecycle hooks.

## Research findings

### Claude Code (authoritative — code.claude.com/docs)

- **`Notification` hook** carries `notification_type`:
  - `permission_prompt` — waiting for the user to approve a tool use.
  - `idle_prompt` — finished responding, waiting for the next prompt.
  - (also `auth_success`, `elicitation_dialog`, …)
- **`Stop` hook** fires when Claude finishes a turn (`assistant_message`, `stop_hook_active`).
- Supports an **`http` hook type**: Claude POSTs the event JSON straight to a
  URL — no shell/curl, cross-platform.
- Hooks configurable via a **per-project `.claude/settings.local.json`** (gitignored
  by Claude, higher precedence than user settings). An `env` block sets env vars;
  `allowedEnvVars` lets those interpolate into request headers.
- Payload always includes stable `session_id` and `cwd`.
- **We never touch the user's global `~/.claude` settings.**

### Other backends (codex, gemini, aider, ollama)

**Out of scope by decision (2026-07-02).** Only Claude Code drives notifications.
Every other backend produces **no** OS notifications after this change (strictly
better than today's false spam). Codex does expose an `agent-turn-complete`
`notify` event and could be added later via the same HTTP receiver, but is
explicitly deferred.

## Design (chosen approach)

### Overview

Notifications originate from **real CLI lifecycle events delivered to a loopback
HTTP receiver in the sidecar**, not from PTY byte heuristics. The sidecar already
owns `NotificationService`, worktrees, and config parsing (per CLAUDE.md layer
boundaries), so the whole path lives there.

```
Claude Code hook ──HTTP──▶ sidecar HookServer (127.0.0.1:<ephemeral>, token)
                                     │  resolve workspace by header
                                     ▼
                            NotificationService.send ──emit "notification.send"──▶ Toaster
```

### Components

**1. `sidecar/hook-server.ts` (new)** — a `Bun.serve` bound to `127.0.0.1` on an
OS-assigned ephemeral port, with a random secret token generated at boot.
- `POST /agent-hook` — auth by token (header `X-Maverick-Token`); rejects any
  request whose token mismatches, and rejects non-loopback peers.
- Body: the Claude event JSON. Correlation: the `X-Maverick-Workspace` request
  header, populated from the injected `env.MAVERICK_WS` via `allowedEnvVars`
  interpolation. No separate registry needed. If the header is absent, notify as
  global (`workspaceId: null`) — fail open rather than swallow a real prompt.
- Maps event → `{type, title, body}` and calls `NotificationService.send`.
  - Claude `Notification`/`permission_prompt` → `agent.attention`.
  - Claude `Notification`/`idle_prompt` → `agent.attention` (waiting for next prompt).
  - Claude `Stop`/`StopFailure` are intentionally NOT notified: `Stop` fires
    every turn and `StopFailure` on transient auto-retried errors, so notifying
    on them would spam a running agent. Completion/errors show only via the
    local status pill (PTY exit code).
- Exposes `{ port, token }` for the config writer. Lifecycle owned by the sidecar
  bootstrap (started in `runServer`, closed on shutdown).

**2. Hook config injection via `--settings` (no worktree pollution).**
`claude --settings <file-or-json>` loads *additional* settings that merge with
the user's own (verified against installed `claude` 2.1.198). So instead of
writing into the user's `.claude/`, the sidecar writes a **Maverick-managed
per-workspace hooks file** (app-data/temp dir, keyed by workspace id) and appends
`--settings <path>` to the `claude` launch args. The user's worktree and global
config are never touched or dirtied.

```jsonc
{
  "hooks": {
    "Notification": [{ "hooks": [{ "type": "http",
      "url": "http://127.0.0.1:<port>/agent-hook",
      "headers": { "X-Maverick-Token": "<token>", "X-Maverick-Workspace": "${MAVERICK_WS}" },
      "allowedEnvVars": ["MAVERICK_WS"], "timeout": 5 }] }]
  },
  "env": { "MAVERICK_WS": "<workspaceId>" }
}
```
- The `env` block sets `MAVERICK_WS` inside Claude's process (portable across
  shells — no shell-prefix plumbing), which interpolates into the correlation
  header.
- **`http` hook support to verify live during implementation.** If the installed
  `claude` rejects `type: "http"`, fall back to a `command` hook that curls the
  receiver (`curl -s -X POST … -d @-`); curl is present on the target macOS and
  the sidecar augments PATH. The plan carries both variants; the live smoke test
  decides.
- Injection happens where the `claude` launch command is assembled
  (`src/lib/launch.ts` / the terminal-first launch flow), gated on
  `backendId === "claude-code"`.
- **Layer boundary:** port + token stay inside the sidecar. The frontend calls a
  new RPC (e.g. `hooks.claudeSettingsPath({ workspaceId })`) that lazily starts
  the hook server, writes the per-workspace settings file, and returns just the
  path. The frontend appends `--settings <path>` and never sees the token.

**3. Frontend decoupling.**
- `src/hooks/useAgentStatus.ts`: keep the `working`/`idle` **visual pill** driven
  by the byte stream (cosmetic, no notifications), but **remove BEL→`attention`**
  (delete `ATTENTION_PATTERN`/`streamRequestsAttention`; output always → `working`).
  `markExit` still sets `done`/`error` for the pill but no longer notifies.
- `src/hooks/useAgentNotifications.ts`: **the entire byte-stream→notify bridge is
  removed** (the hook is deleted and unmounted from the app shell). Attention
  notifications now originate from Claude's `Notification` hook (permission/idle)
  via the sidecar `notification.send` event, which the Toaster and NotificationBell
  already render. This guarantees no double-fire. Done/error are no longer
  OS-notified — they remain only as the local status pill (PTY exit code).
- `src/lib/notification-route.ts`: `ALWAYS_OS_TYPES` retained (a *real* attention
  hook genuinely should always surface), now trustworthy.

### Data flow (Claude, waiting for input)

1. Claude hits a permission prompt → runs the `Notification` http hook.
2. POST `/agent-hook` with `notification_type: permission_prompt`,
   `X-Maverick-Workspace: <id>`, token.
3. HookServer validates token, resolves workspace, calls
   `NotificationService.send({type:"agent.attention", …})`.
4. Sidecar emits `notification.send`; Toaster routes by focus (OS banner when
   away, in-app/suppress when the user is already looking).

### Error handling

- Bad/absent token or non-loopback peer → `401`, no side effect.
- Missing `X-Maverick-Workspace` header → still notify with `workspaceId:null`
  (global) so we fail open rather than swallow a real prompt; log at debug.
- Port bind failure → sidecar logs and continues; hook config is simply not
  written (no receiver), so we degrade to "no notifications" not a crash.
- HTTP hook has a 5s timeout; the receiver returns `200 {continue:true}` fast.

### Testing

- `hook-server.test.ts`: token auth, loopback enforcement, event→notification
  mapping for each `notification_type` and `Stop`, missing-workspace-header
  fail-open, malformed body.
- Config-writer test: fresh write, merge with existing hooks, idempotency.
- `useAgentStatus.test.ts`: BEL no longer produces `attention`; pill still
  goes working→idle.
- `useAgentNotifications.test.ts`: byte-stream transitions no longer call
  `notifySend`.
- Meet CI coverage gate (100% lines / 95% branches). NOTE: the repo's
  `test:coverage` gate is pre-existingly red on main; new modules must be fully
  covered regardless.

## Non-goals

- Codex / gemini / aider / ollama notifications (Claude Code only).
- Changing the NotificationBell history UI.

## Decisions (2026-07-02)

1. **Transport** — loopback HTTP receiver in the sidecar (127.0.0.1, ephemeral
   port, token-gated), matching Claude's native `http` hook type.
2. **Scope** — Claude Code only. All other backends produce no notifications.
3. **Visual pill** — keep the byte-stream working/idle pill (cosmetic); remove
   its notification side effects.
