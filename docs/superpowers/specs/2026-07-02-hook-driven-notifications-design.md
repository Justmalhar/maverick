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

### Codex (developers.openai.com/codex)

- `notify = ["prog", "args"]` in `config.toml`, or injectable per-launch via
  `-c notify=[...]`. Fires only **`agent-turn-complete`** (done). JSON arg:
  `{type, thread-id, turn-id, cwd, input-messages, last-assistant-message}`.
- No native "waiting for input" event via `notify`. Correlate by `cwd`.

### Others (gemini, aider, ollama)

No hook systems. They will produce **no** OS notifications after this change
(strictly better than false spam). Revisiting is out of scope.

## Design (chosen approach)

### Overview

Notifications originate from **real CLI lifecycle events delivered to a loopback
HTTP receiver in the sidecar**, not from PTY byte heuristics. The sidecar already
owns `NotificationService`, worktrees, and config parsing (per CLAUDE.md layer
boundaries), so the whole path lives there.

```
Claude/Codex hook ──HTTP──▶ sidecar HookServer (127.0.0.1:<ephemeral>, token)
                                     │  resolve workspace by header/cwd
                                     ▼
                            NotificationService.send ──emit "notification.send"──▶ Toaster
```

### Components

**1. `sidecar/hook-server.ts` (new)** — a `Bun.serve` bound to `127.0.0.1` on an
OS-assigned ephemeral port, with a random secret token generated at boot.
- `POST /agent-hook` — auth by token (header `X-Maverick-Token`); rejects any
  request whose token mismatches, and rejects non-loopback peers.
- Body: the CLI event JSON. Correlation: `X-Maverick-Workspace` header (Claude,
  via injected `env`+`allowedEnvVars`) with fallback to `cwd` lookup.
- Maps event → `{type, title, body}` and calls `NotificationService.send`.
  - Claude `Notification`/`permission_prompt` → `agent.attention`.
  - Claude `Notification`/`idle_prompt` → `agent.attention` (waiting for next prompt).
  - Claude `Stop` → `agent.done`.
  - Codex `agent-turn-complete` → `agent.done`.
- Exposes `{ port, token }` for the config writer. Lifecycle owned by the sidecar
  bootstrap (started in `runServer`, closed on shutdown).

**2. Workspace↔worktree registry.** The server needs to turn a `cwd`/workspace
header into a `workspaceId`. Add a small in-memory map in `RpcHandlers`
(populated on workspace create/list, cleared on destroy) keyed by canonical
worktree path and by workspace id.

**3. Per-worktree hook config writer (new helper, sidecar).** On workspace
creation (after the worktree exists), write `.claude/settings.local.json` into
the worktree:
```jsonc
{
  "hooks": {
    "Notification": [{ "hooks": [{ "type": "http",
      "url": "http://127.0.0.1:<port>/agent-hook",
      "headers": { "X-Maverick-Token": "<token>", "X-Maverick-Workspace": "${MAVERICK_WS}" },
      "allowedEnvVars": ["MAVERICK_WS"], "timeout": 5 }] }],
    "Stop": [{ "hooks": [{ "type": "http", "url": "…", "headers": {…},
      "allowedEnvVars": ["MAVERICK_WS"], "timeout": 5 }] }]
  },
  "env": { "MAVERICK_WS": "<workspaceId>" }
}
```
- Merge, don't clobber, if the file already exists (preserve user hooks).
- Ensure the worktree's `.claude/` entry is gitignored locally so we don't dirty
  the user's tree (Claude gitignores `.local.json` itself; verify).

**4. Codex `notify` injection.** Add `-c notify=["<helper>", …]` (or a tiny
bundled `codex-notify` script that POSTs to the receiver) to the Codex launch
args in `resolveLaunch`/`BACKEND_COMMAND_FALLBACK`. Correlate by `cwd`. If a
clean per-launch injection proves unreliable, Codex `done` can ship in a
follow-up — Claude coverage is the priority.

**5. Frontend decoupling.**
- `src/hooks/useAgentStatus.ts`: keep the `working`/`idle` **visual pill** driven
  by the byte stream (cosmetic, no notifications), but **remove BEL→`attention`**.
  `attention`/`done`/`error` are no longer derived from bytes.
- `src/hooks/useAgentNotifications.ts`: no longer the notification trigger for
  hook-capable backends. Notifications now arrive via the sidecar `notification.send`
  event (already wired to the Toaster). Reconcile so we don't double-fire: the
  frontend status→notify bridge is removed; the Toaster/NotificationBell keep
  rendering `notification.send` events.
- `src/lib/notification-route.ts`: `ALWAYS_OS_TYPES` retained (attention/error
  from a *real* hook genuinely should always surface), now trustworthy.

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
- Unknown workspace (cwd not in registry) → still notify with `workspaceId:null`
  (global) so we fail open rather than swallow a real prompt; log at debug.
- Port bind failure → sidecar logs and continues; hook config is simply not
  written (no receiver), so we degrade to "no notifications" not a crash.
- HTTP hook has a 5s timeout; the receiver returns `200 {continue:true}` fast.

### Testing

- `hook-server.test.ts`: token auth, loopback enforcement, event→notification
  mapping for each `notification_type`/`Stop`/Codex payload, unknown-workspace
  fail-open, malformed body.
- Config-writer test: fresh write, merge with existing hooks, idempotency.
- Registry test: add/lookup-by-cwd/lookup-by-id/clear-on-destroy.
- `useAgentStatus.test.ts`: BEL no longer produces `attention`; pill still
  goes working→idle.
- `useAgentNotifications.test.ts`: byte-stream transitions no longer call
  `notifySend`.
- Meet CI coverage gate (100% lines / 95% branches). NOTE: the repo's
  `test:coverage` gate is pre-existingly red on main; new modules must be fully
  covered regardless.

## Non-goals

- gemini/aider/ollama hook support.
- Codex "waiting for input" (no event exists).
- Changing the NotificationBell history UI.

## Open questions for review

1. **Transport** — loopback HTTP (chosen) vs file-drop via existing `fs-watcher`
   vs PTY sentinel marker. HTTP is the most robust and matches Claude's native
   `http` hook; confirm acceptable to open a loopback socket (bound to 127.0.0.1,
   token-gated).
2. **Codex scope now vs follow-up** — include Codex `done` in this PR, or land
   Claude-complete first?
3. **Visual pill** — keep the byte-stream working/idle pill (chosen) or delete
   the heuristic wholesale?
