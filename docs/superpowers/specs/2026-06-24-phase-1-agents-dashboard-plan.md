# Phase 1 — Agents Dashboard (parallel loop, worktree `Maverick-Windows-loop2`)

*Date: 2026-06-24 · Branch: `Maverick-Windows-loop2` (isolated worktree, merges back to `Maverick-Windows`)*

## Why a second worktree
A second autonomous session was already running in the `Maverick-Windows` checkout doing the
*feature-completeness* pass (its lane: cross-platform shell helper in `deps.ts` /
`automation-runner.ts` / archive-script in `rpc-handlers.ts`, automation triggers, AI-prefs
consumption). To avoid sharing one git index / stomping its edits, this loop runs in an
isolated worktree on its own branch and owns a **non-overlapping** slice: net-new
**Phase 1 conductor-parity features**, not the completeness fixes.

## Re-baseline (verified against live code, 2026-06-24)
The codebase is ahead of the docs. Phase 1 building blocks already exist:
- `useAgentStatus.ts` — status store + debounced reporter, **fed live** from PTY output via
  `useLaunchSpec.ts` (verified).
- `AgentStatusPill.tsx` — tokenized status indicator.
- Notifications: `notification-service.ts`, `NotificationBell.tsx`, `Toaster.tsx`,
  `os-notify.ts`, `notification-route.ts` — all present.

**The genuine Phase 1 gap:** the **Agents Dashboard itself is missing from the UI.**
- `DashboardView.tsx` is a stub (two stat cards; `totalCost` hardcoded `0`) and is **orphaned**
  — referenced only by its own test.
- The `dashboard` system tab actually renders `<UsagePanel />` (the Usage Manager), so there is
  **no view anywhere that shows per-workspace live agent status** — the defining conductor
  feature ("run agents in parallel, monitor them").

## Plan (TDD, commit per step)
1. **Build `DashboardView` into the real Agents Dashboard.** Per-workspace cards: title/branch,
   project name, branch + backend, live `AgentStatusPill` (via `useAgentStatus`), `data-active`
   for the active workspace, click → `setActiveWorkspace` (canonical focus, matches
   `WorkspaceItem`). Stat row: Workspaces + Active (working|attention) counts. Empty state when
   no workspaces. Failing test first.
2. **Stop orphaning Usage.** Add a `usage` `SystemTabId`; route `dashboard`→`DashboardView`,
   `usage`→`UsagePanel`. Add a "Usage" nav item (`PrimarySideBar`) + `SYSTEM_TAB_META` entry +
   dropdown id (`EditorTabs`). Update `EditorGroup` router + its tests.
3. **Verify gate:** `bun run build`, full vitest suite, `cargo check -p maverick`,
   `cargo test -p maverick-core`. Note manual-click items.

## Result (2026-06-24 — shipped)
- **Step 1 done.** `DashboardView` rebuilt as the Agents Dashboard (cards w/ live status,
  project, branch+backend, click-to-focus; Workspaces + Active stats; empty state). 8 tests.
- **Step 2 done.** `dashboard`→`DashboardView`, new `usage` tab→`UsagePanel`; nav + tab-meta +
  dropdown updated; `EditorGroup` routing tests updated (dashboard→Agents, +usage test).
- **Step 3 done (enhancement).** Each card now fetches its worktree diff (`diffGet`) and shows
  changed-file count + `+adds`/`−dels` — Conductor's at-a-glance review cue. Refetches on live
  status change; hidden when clean. 3 tests. Frontend-only (consumes existing `diff_get`).
- **Gate:** `bun run build` ✅ (tsc + vite clean). Full vitest **1423 passing / 172 files** ✅.
  Rust gate **unaffected** — `git diff` shows zero `.rs`/`Cargo` changes (frontend-only), so the
  base (`0b9effc`) Rust-green state carries; no cold cargo build run (separate target dir +
  concurrent-session CPU contention, zero Rust delta).
- **Needs a human click** (GUI, can't automate here): open the **Dashboard** tab → see a card per
  open workspace; run an agent → watch its card flip working→idle/attention/done; open the new
  **Usage** tab → Usage Manager still renders.

## Carry-forward (do not chase — same as Phase 0 plan)
Coverage% unmeasurable on node 24 (tests-pass is the signal); `cargo test -p maverick` GUI crate
won't launch (wry/webview2); `bun test sidecar/` ~23 POSIX-fixture failures (CI-green).

## Out of lane (other session owns) — do NOT touch
`sidecar/automation-runner.ts`, `sidecar/deps.ts` shell helper, the archive-script `/bin/sh`
block in `sidecar/rpc-handlers.ts`, automation triggers, AI-preferences consumption, and the
Tasks/Kanban "Start-in-Maverick" path.
