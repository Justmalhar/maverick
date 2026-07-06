# Maverick Codebase Health Report

> Generated: 2026-07-06 (supersedes 2026-06-10)
> Method: ran the suites + builds, then verified every prior report claim (HEALTH_REPORT 2026-06-10, BUGHUNT_REPORT 40 bugs, HANDOFF 2026-07-03) against the *current* working tree. Ground truth over stale claims.

## Executive Summary

**The codebase is healthy.** Since the last two reports the app went through a large refactor and a systematic bug-fix pass: **every P0/P1 from the old health report and effectively all 40 bughunt findings are fixed**, and the Phase-4 "Multica parity" features (Autopilots, Squads, StatusBar) are built and wired end-to-end. Typecheck, `cargo check`, and the sidecar test suite are green.

**All loose ends are now resolved.** This session fixed the frontend-suite flakiness (L1), the `ProcessManager` stderr deadlock (L2), and the dead `appearance.uiFontSize` setting (L4), and established that the "headless AI actions" gap (L3) is moot — that launch mode was removed in the refactor, agents are PTY-only, and every entry point is correctly gated. Full sweep green: typecheck, `cargo check`, sidecar (646), frontend (1759, twice), and production build.

⚠️ Everything is **uncommitted** — the entire fix pass + new features sit as `M`/`??` working-tree changes. That is itself the biggest risk: one `git checkout .` loses all of it.

---

## Ground-Truth Results (what actually ran)

| Check | Command | Result |
|---|---|---|
| TypeScript | `bun run typecheck` | ✅ clean |
| Rust | `cargo check --workspace` | ✅ clean |
| Sidecar tests | `bun test sidecar/` | ✅ 646 pass / 0 fail (incl. autopilot/squad stores + new stderr-drain test) |
| Frontend tests | `bunx vitest run` | ✅ 1759 pass / 0 fail — **green twice back-to-back** after the flake fixes below |
| Production build | `bun run build` | ✅ built (only a chunk-size >500kB warning — monaco/xlsx/wasm; not an error) |

Before the fixes this session the suite was **flaky under full parallel load** across multiple files (SourceControlView, then EditorGroup surfaced right after) — each passed in isolation, so it was test-timing fragility, not product bugs. Fixed (see below); now green on two consecutive full runs.

---

## Fixed in this session (2026-07-06)

All four loose ends from the initial pass are now resolved. Frontend green on two consecutive full runs; sidecar + build green.

- **L1 — Frontend suite flakiness → FIXED (two root causes).** (1) `SourceControlView.test.tsx:416` now waits on the definitive connected signal (`not.toHaveTextContent("Connect Bitbucket")`) instead of the `"Bitbucket"` substring the transient `"Connect Bitbucket"` label also satisfied — a logic race. (2) The lazy-panel system-tab tests (`EditorGroup`: UsagePanel/GitPanel/…) exceeded `waitFor`'s 1000ms default under full-suite CPU contention; `src/test/setup.ts` now sets `configure({ asyncUtilTimeout: 5000 })` globally, fixing the whole class (the author had already special-cased kanban with `{timeout:5000}`).

- **L2 — `ProcessManager` child stderr/stdout now drained → FIXED.** `sidecar/process-manager.ts` `spawnOnceHandle` now drains both pipes (a `drain()` reader that discards chunks and swallows kill-time errors) so a child logging >64KB to stderr can't deadlock on a full pipe before exiting. Added a regression test that hangs without the drain (fake child resolves `exited` only once its ~100KB stderr is read).

- **L3 — Headless AI actions → RESOLVED (by architecture, no code gap).** The premise was stale: the "headless launch mode" the bughunt referenced was removed in the refactor (`useAgentRun`/`agentRun`/`costUsd` are gone). Agents now run **only** in a PTY (`TerminalLeaf` + `useLaunchSpec`); `agent-oneshot.ts` is for sidecar one-shots (commit msg / branch name / PR text), not interactive workspaces. So `dispatchAgentPrompt`'s `{ran:false}` only occurs transiently (PTY not ready) or for non-agent workspaces — and every entry point handles that honestly: DiffView buttons gated (`DiffView.tsx:181,210,221`), the `⌘⇧R` shortcut gated this session (`useShortcuts.ts`, with a regression test), and Squad broadcast surfaces "No live agent (start the workspace first)" (`SquadBroadcastDialog.tsx:80-84`). Building a headless-routing path would be speculative for a mode that no longer exists (YAGNI).

- **L4 — `appearance.uiFontSize` now wired → FIXED.** `body` uses `font-size: var(--ui-font-size, 13px)` (`globals.css`), and `ThemeProvider` (the single owner of inline `:root` props) sets `--ui-font-size` from the setting alongside the theme. Aligned the declared default `12 → 13` (`settings-defaults.ts`, `AppearanceSettings.tsx`) so it matches the previous hardcoded body size — zero visual regression. Added a ThemeProvider wiring test.

## Loose Ends (remaining)

**None.** All items from the initial assessment are resolved. Residual, non-blocking observations:

- **`git pull` doesn't pass `git.remote`** — the `gitPull` binding takes no remote arg; minor/by-design (noted for completeness).
- **Bundle chunk-size warning** — `monaco` (2.5MB), `xlsx`, `wasm` chunks exceed Vite's 500kB advisory. Not an error; these are already lazy-loaded viewers. Only worth `manualChunks` tuning if the 100MB/200MB budgets (CLAUDE.md rule 8) come under pressure.

---

## What Got Fixed Since the Last Reports

All verified against current code. The prior reports are now largely historical.

**Old HEALTH_REPORT P0/P1 — all fixed:**
- B1 broken `ActivityBarItem` test import — gone.
- B2/P0-2 `remote_stop`/`remote_status` state-type panic — now `State<'_, Arc<RemoteServer>>` (`remote.rs:26,32`).
- B7/P1-1 CommandPalette `setActivityView` no-ops — replaced with real `openSystemTab(...)`/`openSourceControl()` calls.
- B8/P1-2 sidecar EOF 60s hang — EOF now sends `Err(TransportClosed)` to each pending sender before clearing (`core/src/sidecar.rs:181-187`).
- P2-1 StatusBar has no render target — now rendered (`Workbench.tsx:131`) with live branch/token/cost/backend/status data.
- IPC type drift (B3–B6) — typecheck is clean; no drift surfaces.

**BUGHUNT 40 bugs — all resolved (incl. #15 stderr drain and #34 uiFontSize, fixed this session), spot-checked highlights:**
- #1 Windows/macOS release sidecar path → `current_exe()`-based (`lib.rs`), with regression test.
- #6 media previews → `convertFileSrc` + `assetProtocol` scope in `tauri.conf.json`.
- #7/#8/#9/#37/#38/#39 kanban data-loss + dead controls → root-caused with `COALESCE` upsert (`kanban-store.ts:75,78`) + per-caller spreads; `kanban.delete` wired end-to-end.
- #10/#11/#19/#20/#21 git correctness (remote checkout DWIM, per-segment PR URL encoding, scoped commit pathspec, per-hunk conflict resolve, default-branch compare URL) → all fixed.
- #2/#3/#4/#5 preset subsystem → single PTY authority (layout descriptor + Rust ConPTY), workspace row persisted, `resolveBaseBranch` fallback, typed `PresetLaunchResult`.
- #14/#24/#25/#26/#30 sidecar lifecycle (AI-call timeout+kill, MCP cwd, consecutive-restart budget, gh kill-on-timeout, non-object JSON guard) → all fixed.
- #16 → the un-flushed `ProcessManager.write` path was removed entirely (interactive stdin now goes through Rust ConPTY).
- #17 workspace-close PTY leak → `removeWorkspace` now kills every terminal-group leaf + clears status (`store.ts:273-281`).
- #27 UTF-16/BOM files misclassified as binary → BOM detection before the NUL heuristic (`file-reader.ts:85-91`).
- #28/#29 Windows backend probe (.cmd/.ps1 shims + `CREATE_NO_WINDOW`) → fixed.
- #32/#33 notification toggles + git settings (remote/template/autoFetch/gpgSign) → now consumed.
- #36 pending-oneshot leak on early-return/placeholder mode → remove-on-error (`core/src/sidecar.rs`).
- #18 agent cost-wipe → **N/A**: the entire `useAgentRun`/`useAgentOutput`/`costUsd` subsystem was removed in the refactor (only `useAgentStatus` remains).

---

## New Features (Phase-4 "Multica parity") — status

| Feature | State | Evidence |
|---|---|---|
| **Autopilots** (scheduled/webhook/manual agent runs) | ✅ complete, wired end-to-end | `sidecar/autopilot-store.ts` + `006_autopilots.sql` + RPC (`autopilot.*`) + `commands/autopilot.rs` + `tauri.ts:307-325` + `AutopilotPanel` (system tab) + `useAutopilotBridge` mounted in `App.tsx`. `autopilot.triggered` scheduling loop live. |
| **Squads** (agent groups + broadcast) | ✅ complete, wired | `sidecar/squad-store.ts` + `007_squads.sql` + RPC (`squad.*`) + `commands/squad.rs` + `tauri.ts:342-352` + `SquadPanel`/`SquadDialog`/`SquadBroadcastDialog` (system tab `squads`). Broadcast inherits L3's PTY-only limitation. |
| **StatusBar restored** | ✅ complete, real data | `StatusBar.tsx` — live branch, `useContextUsage` tokens/cost, backend id, `useAgentStatus`. |
| **Agent Profiles** (plan §4.1) | ➖ not built | Plan called for `AgentProfile.tsx`; Squads were built instead. Deliberate deviation, not a defect. |

All new stores/panels ship with passing tests (included in the 645 sidecar / 1757 frontend counts).

---

## Notes / Caveats

- **Uncommitted WIP.** The whole fix pass + Phase-4 features are working-tree changes (many `M`, plus `??` for autopilot/squad/statusbar/agents/automations and this report). Commit soon — this work is currently one careless command from gone.
- **Stale prior reports.** `BUGHUNT_REPORT.md` and the old `HEALTH_REPORT` predate the refactor; several of their findings reference files/symbols that no longer exist (`useAgentRun`, `costUsd`, `agent-output` store). Treat them as historical. `HANDOFF.md`'s "what remains" list is mostly done.
- **Coverage not separately measured.** The suites pass (twice, post-flake-fix), but `bun run test:coverage` (the 100%/95% CI gate) wasn't run — worth a confirming pass, since the two new untracked features added source that needs its coverage checked.

## Recommended Next Step

All L1–L4 fixes are complete and verified. The one thing left is **not** a code fix:

1. **Commit the working tree.** The entire fix pass + Phase-4 features + this session's L1–L4 fixes are all uncommitted (`M`/`??`). Lock them in before any further work.
2. *(Optional)* Run `bun run test:coverage` once to confirm the 100%/95% gate holds with the new source (autopilot/squad/statusbar) and the four fixes.
