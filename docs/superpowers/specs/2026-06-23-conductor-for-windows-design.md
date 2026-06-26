# Conductor-for-Windows — Design Spec

*Date: 2026-06-23 · Author context: Manan · Branch: Maverick-Windows*

## 1. Problem & Intent

Maverick should match the capabilities of **conductor.build** — the macOS app that runs
Claude Code / Codex / Cursor agents **in parallel**, each task isolated in its own git
worktree + branch + terminal + diff + review path — but on **Windows first**.

Maverick already owns most of Conductor's primitives (multi-workspace, per-workspace
worktrees + branches, diff viewer with hunk staging, "Create PR" via `gh`, setup/archive/run
scripts, presets). This effort is therefore **(a) fixing the foundation so those primitives
actually work, then (b) adding the orchestration + review layer Conductor wraps around them.**

### Source product clarification
- **In scope:** `conductor.build` (parallel AI coding agents).
- **Explicitly out of scope:** `conductor-oss` / `conductoross.com` (Netflix microservices
  workflow-orchestration engine). Unrelated product that happens to share the name. No DAG
  engine, no distributed task scheduling.

## 2. Goals / Non-Goals

**Goals**
- Windows x64 is the primary, proving-ground platform (ConPTY via `portable-pty`, Windows
  worktree path handling, no POSIX symlink assumptions). Mac/Linux must keep working.
- **Shell choice on Windows:** PowerShell (default), cmd, and WSL selectable per terminal.
- Reach feature parity with conductor.build's workflow: run agents in parallel, monitor
  them, review their diffs with inline comments that the agent iterates on, then PR + archive.

**Non-Goals (v1)**
- Multiple agents sharing one workspace/branch. v1 = **one workspace = one agent = one branch.**
- Cloud / distributed scheduling, agent→agent DAGs, billing tiers.
- Reviving the legacy chat-based `AgentView` as the primary surface (terminal-first stays default).

## 3. Architecture (reuse, don't rebuild)

Maverick's three layers stay as-is (React → Rust JSON-RPC pass-through → Bun sidecar →
CLIs). All new work layers on top of existing primitives:

- **PTYs** remain authoritative in Rust (`src-tauri/core/src/pty/`).
- **Worktrees** stay in `sidecar/worktree-manager.ts`.
- **Agent status** for the dashboard derives from the existing PTY normalizers in
  `src-tauri/core/src/remote/adapters/` (`claude.rs`, `codex.rs`, `heuristic.rs`).
- Cross-layer types stay mirrored in `src/lib/ipc.ts` and `sidecar/types.ts`.

## 4. Phasing

Phase 0 ships **fully before** Phase 1 begins (interdependent foundation work). Phases 1–3
each get their own spec → plan → implement cycle when reached. This document specs Phase 0 in
detail and outlines 1–3.

---

### Phase 0 — Foundation (make the primitives actually work)

Nothing Conductor-like functions until these are fixed.

**0.1 Terminal-Mode PTY-per-leaf binding (P0-A)**
- Bug: split terminal leaves hardcode `ptyId: workspace.id`, which never matches the real
  `pty_N` id returned by Rust, so panes show no output and ignore keystrokes.
- Fix: each `TerminalView` leaf spawns its own PTY and binds to the returned id; the
  `SplitGrid` tracks `leafId → ptyId`.
- Files: `src/components/editor/terminal/**`, `src/lib/providers/**`, `src/hooks/usePty.ts`.

**0.2 Register missing git write commands (P1-A)**
- 9 git write commands exist in the sidecar but are not registered in Rust `lib.rs`, so they
  fail "command not found": `git_checkout`, `git_blame`, `git_cherry_pick`,
  `git_stash_apply`, `git_stash_pop`, `git_stash_drop`, `git_conflicts`,
  `git_resolve_conflict`, (+ verify the 9th against `sidecar/git-module.ts`).
- Files: `src-tauri/src/lib.rs`, `src-tauri/src/commands/git.rs`.

**0.3 Render the shell chrome (P0-E)**
- `StatusBar`, `ActivityBar`, and `Panel` are built but never mounted in `Workbench`.
  Mount them. Wire `NotificationBell` and `CaffeinateToggle` (built, unrendered) into
  `StatusBar`.
- Files: `src/components/workbench/Workbench.tsx`, `src/components/statusbar/**`,
  `src/components/activitybar/**`, `src/components/panel/**`.

**0.4 PTY lifecycle hardening (P0-B/C/D)**
- Kill PTYs on `workspace.destroy` (process leak).
- Batch xterm writes in a 16ms RAF window (perf rule).
- LRU xterm renderer pool so inactive groups release renderers (`display:none` keep-alive
  stays, but renderer count is bounded).
- Files: `src-tauri/core/src/pty/**`, `src/lib/providers/xterm-provider.ts`,
  `sidecar/process-manager.ts`.

**0.5 Windows shell selection (NEW — Windows core feature)**
- A terminal can launch under **PowerShell (default)**, **cmd**, or **WSL**.
- Config: a `defaultShell` field (`powershell` | `cmd` | `wsl`) in `maverick.json`
  (per-repo) with a global fallback; resolves to the right executable + args at PTY spawn
  (`pwsh`/`powershell.exe`, `cmd.exe`, `wsl.exe`).
- UI: shell picker in the new-terminal / split affordance and in Settings → Terminal.
- Non-Windows platforms keep their existing default shell; the picker only surfaces the
  installed shells.
- Files: `sidecar/process-manager.ts` (shell resolution), `sidecar/config-loader.ts`
  (`defaultShell`), `src-tauri/core/src/pty/**` (spawn args), `src/components/editor/terminal/**`
  + `src/panels/settings/**` (picker UI), `src/lib/ipc.ts` + `sidecar/types.ts` (type).

**0.6 Windows worktree verification**
- Verify `worktree-manager.ts` create/destroy works with Windows path separators and the
  `.maverick/worktrees/` base; no symlink assumptions; files-to-copy works on Windows.
- Files: `sidecar/worktree-manager.ts` (+ tests).

**Phase 0 done =** `bun run build` + `cargo check` pass, `bun run test:coverage` +
`cargo test` pass at thresholds, and on a real `bun run tauri dev`: a workspace opens a
PowerShell terminal by default, split panes each show live output, git panel write actions
work, StatusBar/ActivityBar/Panel are visible, and switching shells to cmd/WSL works.

---

### Phase 1 — Orchestration core (outline)
- **Agents Dashboard** (new `PrimarySideBar`/`ActivityBar` view): each workspace as a card
  with live status *running / waiting-for-input / idle / done / error*, derived from the
  `remote/adapters/` PTY normalizers.
- **Notifications** (OS + in-app via the now-rendered `NotificationBell`) on agent-finished
  and input-needed; wire `sidecar/notification-service.ts`.
- **Start in Maverick from a task**: seed a worktree + agent PTY from a Kanban task
  description (closes existing Kanban gap).

### Phase 2 — Review loop (outline)
- Inline **comment-on-diff-line** UI in `DiffView`.
- **Decision:** collect comments, batch into one structured prompt (`Re: <file>:<line> — …`),
  and `pty.write` it into the active workspace's agent PTY. Rationale: honors terminal-first
  default, reuses `DiffView` + `pty.write`, backend-agnostic. "Send to agent" is explicit
  (not auto-fired) and gated on agent-idle detection from the adapters.
- Hunk navigation `]c`/`[c`, stage/unstage `⌘⇧A`/`⌘⇧U`.

### Phase 3 — Lifecycle polish (outline)
- **Checks tab** in `AuxiliaryBar`: git status, CI (via `gh`), todos.
- **Archive flow**: post-merge → run archive script → `git worktree remove` → card leaves
  dashboard (wire to existing `workspace.destroy`).
- "Save current layout as preset" + per-workspace setup/run-script polish.

## 5. Testing

Per CLAUDE.md thresholds (lines 100 / branches 95 / functions 100 / statements 100). Every
public function gets a test. Vitest + MSW for React/TS, `bun test` for sidecar (mock
`Bun.spawn`), `cargo test` for Rust (fixture JSON-RPC stream). Shell-selection tests must
cover all three Windows shells' resolution logic.

## 6. Risks

- **Shell resolution on varied Windows installs** — `pwsh` (7+) vs `powershell.exe` (5.1) vs
  WSL not installed. Resolution must degrade gracefully and the picker must only offer
  installed shells.
- **PTY-idle detection** (Phase 2) is heuristic per backend; gate the review-loop send button
  conservatively.
- **Parallel execution by multiple human-driven terminals** races on one checkout — use one
  looped session for Phase 0, or per-worktree isolation for later phases.
