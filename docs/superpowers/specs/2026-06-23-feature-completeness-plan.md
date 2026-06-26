# Feature-completeness audit (Windows) — plan

*Date: 2026-06-23 · Branch: Maverick-Windows*

Re-baseline of every feature's end-to-end path. Most are already fully wired; the real work is
a small set of Windows-shell bugs + two stubbed sub-features.

## Inventory verdict

| Feature | Status | Gap |
|---|---|---|
| Tasks/Kanban + Composer | ✅ WORKS | Send→kanban.upsert + Start-in-Maverick wired; dropdowns, drag-drop, attachments, filter all real |
| Projects sidebar | ✅ WORKS | add-project, settings, create-from, add-workspace all wired |
| MCPs | ✅ WORKS | add/start/stop/list/logs registered; Bun.spawn resolves .cmd/.exe on Windows |
| Skills | ✅ WORKS | global+repo load, /skill, interpolation, editor save |
| Presets | ✅ WORKS | launch spawns worktree + PTYs |
| Automations | ⚠️ PARTIAL | shell step uses POSIX `sh` (Windows-broken); `schedule` + `on-file-change` triggers are UI-only stubs |
| Project Settings | ⚠️ PARTIAL | persists + setup/run/archive wired; **archive runs via `/bin/sh` (Windows-broken)**; AI-preferences fields may be written-but-never-read |

## Fixes (this pass, ordered)

1. **[CRITICAL] Cross-platform shell for script execution.** `sidecar/rpc-handlers.ts:490`
   (archive script) hardcodes `/bin/sh`; `sidecar/automation-runner.ts:84` (shell step) uses
   `sh`. Both fail on Windows. Add `shellCommandArgs(command)` to `deps.ts` → `["cmd","/c",cmd]`
   on Windows, `["/bin/sh","-c",cmd]` on POSIX; use at both sites. Update tests to assert via the
   helper (platform-aware).
2. **[DONE] Cross-platform shell** — committed: `shellCommandArgs()` used by archive + automation
   shell steps. Verified (deps + automation tests pass; sidecar imports clean).

## Remaining — design-needed sub-features (NOT Windows bugs; incomplete on all platforms)

These need a design decision, so they're left for a focused design+build pass rather than a
blind unattended build:

3. **Automations `schedule` + `on-file-change` triggers** — CONFIRMED no scheduler/watcher exists
   (`automation-runner.ts` has no cron/setInterval/watch). Recommended design: register active
   triggers per open workspace; `on-file-change` → debounced (≈500ms) hook on the existing
   fs-watcher running `automation.run` in that worktree; `schedule` → sidecar interval tick
   (simple `Nm/Nh` cadence, not full cron). Open questions: activation lifecycle (per
   workspace-open? persisted + auto-start on sidecar boot?), watcher scope, overlap guarding —
   hence design-first.
4. **AI preferences consumption** — CONFIRMED `project.preferences.*` is parsed/persisted
   (`project-settings.ts`) but read by NO execution path (only `InstructionsResolver`, which is
   MAVERICK.md, is wired). Recommended: inject the preferences map into the agent launch prompt
   or merge into resolved instructions on workspace create. Open question: where prefs sit
   relative to MAVERICK.md and per-skill prompts — design-first.

## Carry-forward (do not chase)
Coverage% on node 24 (both providers fail; tests-pass is the signal; don't weaken thresholds);
`cargo test -p maverick` GUI-crate launch (wry/webview2); `bun test sidecar/` ~23 POSIX-fixture
failures (production correct, pass on CI). Caffeinate is a documented no-op on Windows.
