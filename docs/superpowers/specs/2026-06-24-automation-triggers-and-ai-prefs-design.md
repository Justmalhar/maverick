# Automation triggers + AI-preferences injection — Design

*Date: 2026-06-24 · Branch: Maverick-Windows · Status: approved*

Completes the two PARTIAL features from the feature-completeness audit
(`2026-06-23-feature-completeness-plan.md`). Both are incomplete on all platforms (not Windows
bugs). Decisions are locked (see "Decisions").

## Decisions
- **Automation trigger lifecycle:** per OPEN workspace. Triggers for a project are active only
  while a workspace of that project is open; they die on close. No firing while the app/workspace
  is closed. No orphan timers/watchers.
- **Schedule format:** simple interval — `Nm` / `Nh` / `Nd`. No cron dependency.
- **on-file-change:** debounced ~500ms; watches the worktree minus the standard ignore set
  (`.git`, `node_modules`, `dist`, `target`, `.next`, `.maverick`).
- **AI preferences delivery:** prepend a preamble to the agent LAUNCH prompt (task → agent). No
  repo files written. Backend-agnostic. Bare terminals the user types into don't receive them.

## Feature A — Automation triggers

### `sidecar/trigger-manager.ts` (new unit)
Owns active timers + watchers keyed by `workspaceId`.

- `activate({ workspaceId, projectPath, worktreePath })`:
  - Load the project's automations via `ConfigLoader.load`.
  - `trigger: "schedule"` → parse cadence (`parseInterval("30m") → 1_800_000` ms) and
    `setInterval` that runs the automation in `worktreePath` via `AutomationRunner.run`.
  - `trigger: "on-file-change"` → register a debounced (500ms) watch on `worktreePath` (reusing
    `fs-watcher`, ignore set above) that runs the automation.
  - `trigger: "manual"` → ignored (run on demand as today).
- `deactivate(workspaceId)`: clear all timers + watchers for that workspace.
- **Overlap guard:** per (workspaceId, automationName), skip a new run while the previous is
  in flight (an in-flight `Set`).
- Injectable deps (timer/watcher/runner/clock) so it's unit-testable without real time or fs.

### Cadence parser
`parseInterval(s: string): number | null` — `^(\d+)(m|h|d)$` → ms; returns null for invalid
(invalid schedules are skipped + logged, never crash activation).

### Lifecycle wiring
- New RPC methods: `automation.activateTriggers({ workspaceId, projectPath, worktreePath })`,
  `automation.deactivateTriggers({ workspaceId })`. Rust commands
  `automation_activate_triggers` / `automation_deactivate_triggers` registered in `lib.rs`;
  `@/lib/tauri` wrappers; sidecar dispatch in `rpc-handlers.ts` → `TriggerManager`.
- Frontend calls **activate** when a workspace becomes open and **deactivate** when it
  closes/destroys, via a small effect off the existing workspace lifecycle (`useWorkspace` /
  the workspace editor mount). Idempotent: re-activate replaces prior handles for that id.

## Feature B — AI preferences → launch-prompt preamble

### `formatPreferences(prefs: Record<string,string>): string` (pure)
- Empty / all-blank → `""`.
- Else a compact block:
  ```
  [Project preferences]
  - general: be terse
  - review: always run tests
  ```
  Keys sorted for determinism; blank values skipped.

### Wiring
When the Composer "Send" / Start-in-Maverick assembles the agent launch prompt (task
title+description), prepend `formatPreferences(prefs)` (from the loaded `useProjectSettingsStore`)
+ a blank-line separator. `prefs` empty → prompt unchanged. Lives where the launch prompt is
built (frontend), as a pure compose step.

## Testing
- `parseInterval`: valid units, invalid → null.
- `TriggerManager` (injected fake timer/watcher/runner/clock): schedule starts an interval that
  fires the runner; on-file-change fires debounced; manual ignored; deactivate clears everything;
  overlap guard skips concurrent runs; invalid cadence skipped without throwing.
- `formatPreferences`: empty → "", blanks skipped, sorted, multi-key block.
- Frontend: composer prepends preamble when prefs present; identical prompt when empty.
- RPC: activate/deactivate dispatch to TriggerManager (rpc-handlers test with a fake manager).
- Cross-platform: no shell/path assumptions; automation runs go through `AutomationRunner`
  (already uses `shellCommandArgs`). Tests are platform-independent.

## Out of scope (v1)
Full cron; triggers firing while app/workspace closed; prefs for ad-hoc terminals; per-automation
enable toggle UI (lifecycle handles activation).
