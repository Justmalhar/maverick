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
2. **Automations triggers.** `schedule` + `on-file-change` are accepted by the schema and shown
   in the builder but never executed. Wire `on-file-change` to the existing fs-watcher and
   `schedule` to a simple interval/cron tick in the sidecar. (Larger; after #1.)
3. **AI preferences consumption.** Verify whether `project.preferences.*` is read by any
   execution path (workspace create / agent launch). If genuinely dead, wire it into the launch
   spec; if intentionally future, document it.

## Carry-forward (do not chase)
Coverage% on node 24 (both providers fail; tests-pass is the signal; don't weaken thresholds);
`cargo test -p maverick` GUI-crate launch (wry/webview2); `bun test sidecar/` ~23 POSIX-fixture
failures (production correct, pass on CI). Caffeinate is a documented no-op on Windows.
