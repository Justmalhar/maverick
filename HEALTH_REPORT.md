# Maverick Codebase Health Report

> Generated: 2026-06-10

## Executive Summary

The codebase is in an active mid-refactor state. `ActivityBar` and `StatusBar` shell components have been deleted and absorbed, `BottomTerminal` has been replaced by standalone editor terminal tabs, and the sidecar gained provider-aware PR creation plus home-rooted worktrees. The Rust layer has one critical runtime panic bug in the remote commands. Type contract drift between `sidecar/types.ts` and `src/lib/ipc.ts` has accumulated across 4 interfaces. One broken test import blocks the entire test suite from passing today.

---

## What Works

- **Workbench shell compiles cleanly.** `Workbench.tsx` imports `TitleBar`, `PrimarySideBar`, `AuxiliaryBar`, `EditorArea`, `QuickOpen`, `CommandPalette`, `Toaster`, and 4 lazy panels — all exist on disk and resolve correctly.
- **TerminalView/TerminalPane xterm boundary is intact (Rule 4).** Neither file imports xterm directly; all terminal access goes through `TerminalRegistry.get()` in `src/lib/terminal-provider.ts`.
- **PTY keep-alive mount pattern is correct.** `EditorGroup.tsx` uses `display:none` + `content-visibility: auto` on inactive groups; PTYs survive tab switches.
- **Visible-guard on TerminalView split/focusDirection listeners is fixed.** Dormant keep-alive terminals no longer respond to keyboard splits meant for active ones.
- **First-leaf auto-focus added.** Stale `focusedPaneId === null` race on fresh terminal tabs is resolved.
- **File drop integration in TerminalPane is complete.** `registerFileDropTarget`, drop overlay, shell-escaped path writes, and unmount cleanup all implemented with tests.
- **Sidecar RPC dispatch is complete.** All ~55 documented methods have handlers; no `Unknown method` dead-ends in production paths.
- **Provider-aware PR creation works.** GitHub (`gh pr create`), Bitbucket, and GitLab all have distinct flows; fallback to compare URL when `gh` is not installed.
- **SQLite schema is sound.** 5 migrations applied idempotently via `schema_migrations` bootstrap guard; WAL mode and foreign keys enabled.
- **Worktree manager `base`/`dirName` params and `resolveBaseBranch` are functional.** Collision-safe directory naming and priority-chain branch resolution are implemented and tested.
- **Preset-launcher home-rooted worktrees work.** Preset branches land in `~/.maverick/<slug>/worktrees` rather than inside the repo.
- **`workspace.create` setup-script removal is intentional and complete.** The frontend now streams setup asynchronously; tests are updated accordingly.
- **All 78 `invoke()` calls in `src/lib/tauri.ts` have matching Rust command registrations in `lib.rs`.**
- **All new commands (`git_remote_info`, `ai_commit_message`, `skills_list_global`, `skills_create_global`) are registered end-to-end.** Rust command, `lib.rs` handler, and sidecar RPC handler are all present.
- **Degraded mode on sidecar spawn failure.** `Sidecar::placeholder()` returns `TransportClosed` errors instead of crashing the process.
- **`PrimarySideBar` ActivityBar absorption is clean.** No dangling imports from the deleted `activitybar/` directory.
- **`CreateFromDialog` and branch-picker flow in `ProjectsView` are implemented and tested.**
- **SkillsPanel and SkillEditorPanel wired into EditorGroup as lazy imports.**
- **Brand icon integration in `EditorTab.tsx` works.** Backend brand icon renders for agent tabs; terminal tabs keep `TerminalSquare`. Unknown-backend fallback tested.

---

## What is Broken

| # | Issue | Location |
|---|-------|----------|
| **B1** | Test imports deleted `ActivityBarItem` — causes `Cannot find module` at startup, failing the entire test file | `src/components/editor/EmptyEditor.reduced.test.tsx:33` |
| **B2** | `remote_stop` and `remote_status` use `State<'_, RemoteServer>` but `lib.rs` manages `Arc<RemoteServer>` — Tauri v2 panics with "state not managed" at call time | `src-tauri/src/commands/remote.rs:27,33` |
| **B3** | `ConflictHunk.binary` required on frontend but optional in sidecar — silent `undefined` where `boolean` expected | `src/lib/ipc.ts:275` vs `sidecar/types.ts` |
| **B4** | `MCPServer.restarts` optional on frontend but always emitted by sidecar | `src/lib/ipc.ts:144` vs `sidecar/types.ts:122` |
| **B5** | `MaverickConfig.mcps` typed as `MCPServer[]` on frontend but `MCPServerConfig[]` in sidecar — config save/load structural mismatch | `src/lib/ipc.ts:245` vs `sidecar/types.ts:65` |
| **B6** | `GitProvider` and `RemoteInfo` added to `ipc.ts` but not to `sidecar/types.ts` — bifurcated definitions that will drift | `src/lib/ipc.ts:261–269` |
| **B7** | `CommandPalette` `setActivityView()` calls write to store state nothing reads anymore — `view.git`, `view.kanban`, `view.browser`, etc. are silently no-ops | `src/components/quickopen/CommandPalette.tsx:62–132` |
| **B8** | Sidecar EOF drops all oneshot senders without sending errors — outstanding callers hang for full 60-second timeout | `src-tauri/src/sidecar.rs:181–184` |
| **B9** | `GitModule.remoteInfo` and `GitProviderModule.remoteInfo` are identical — the provider module version is dead code | `sidecar/git-module.ts:396` vs `sidecar/git-provider.ts:90` |

---

## What is Incomplete / In Progress

- **StatusBar has no replacement.** The 22px bottom strip is deleted from `Workbench.tsx`. Token usage (`useContextUsage`), ahead/behind commit count, backend connection status, and quota display hooks exist but have no render target.
- **NotificationBell has no replacement.** Transient toasts remain; no unread-count badge or persistent notification history indicator.
- **`⌘⇧T` New Terminal shortcut removed** from `EditorTabs.tsx` without confirmed replacement in `src/shortcuts/registry.ts`.
- **`src/panels/skills/` is untracked.** `EditorGroup.tsx` lazy-imports `SkillsPanel` and `SkillEditorPanel` from it — if those files don't exist, the panel throws at runtime.
- **`workspaceGet` always returns `sessionId: ""`** (hardcoded); `workspaceList` fetches the real session ID. Callers reading `sessionId` from a single-workspace fetch get stale empty string.
- **`mcp.add` does not validate MCP config before persisting.** An empty-string `command` is saved to `maverick.json` and only fails at `mcp.start` time.
- **`ai_commit_message` can exceed the 60-second sidecar timeout.** `claude -p` on slow network or cold start can take 30–90 seconds — the pending request gets dropped, leaving a zombie subprocess.
- **6 Rust remote commands have no frontend wrappers.** `remote_start`, `remote_stop`, `remote_status`, `remote_pair`, `remote_devices`, `remote_revoke`, and `pty_close_all` are registered in Rust but have zero `invoke()` wrappers in `src/lib/tauri.ts`.
- **`skills` and `skill-editor` tabs share `Sparkles` icon** — visually indistinguishable when both are open simultaneously.
- **`MaverickConfig.project` field absent from `ipc.ts`** but present in `sidecar/types.ts` — silent data loss on the React side.
- **SQLite `workspaceDestroy` uses manual cascade** instead of `ON DELETE CASCADE` — new FK-linked tables added without updating this method will leave orphaned rows.
- **`kanban.upsert` uses `as never` cast**, bypassing all type validation on the merged input object.
- **5 stale comments** reference deleted components in `src/test/setup.ts`, `src/lib/notification-route.ts`, `src/components/notifications/Toaster.tsx`, `src/components/editor/terminal/TerminalLeaf.tsx`, `src/hooks/useSourceControl.ts`.

---

## Critical Issues (P0)

Issues that prevent the app from running correctly or the test suite from passing.

### P0-1: Broken test import blocks CI

- **File:** `src/components/editor/EmptyEditor.reduced.test.tsx:33`
- `import { ActivityBarItem } from "@/components/activitybar/ActivityBarItem"` — module deleted. Test suite fails at startup with module resolution error. The test at line 49 that renders `<ActivityBarItem>` must also be removed or replaced.

### P0-2: Runtime panic in remote commands

- **File:** `src-tauri/src/commands/remote.rs:27,33`
- `remote_stop` and `remote_status` use `State<'_, RemoteServer>` but `lib.rs` manages `Arc<RemoteServer>`. Tauri v2 panics with "state not managed" when either is invoked.
- **Fix:** change both signatures to `State<'_, Arc<RemoteServer>>`.

---

## High Priority Issues (P1)

Issues that are broken in meaningful ways but don't block app startup.

### P1-1: `activityView` state written but never read — 7 CommandPalette commands are no-ops

- **File:** `src/components/quickopen/CommandPalette.tsx:62–132`
- All `setActivityView("git")`, `setActivityView("kanban")`, etc. write to store state that `PrimarySideBar` no longer reads after the ActivityBar deletion. Commands `view.git`, `view.kanban`, `view.browser`, `view.automations`, `view.mcps`, `view.projects` appear to work but change nothing visible.

### P1-2: Sidecar EOF causes 60-second hang on all in-flight requests

- **File:** `src-tauri/src/sidecar.rs:181–184`
- `pending.clear()` drops all oneshot senders without sending errors. Outstanding `request()` callers block for the full timeout.
- **Fix:** iterate pending and send `Err(SidecarError::TransportClosed)` to every sender before clearing.

### P1-3: `ConflictHunk.binary` missing from `ipc.ts`

- **Files:** `src/lib/ipc.ts:275`, `sidecar/types.ts`
- Sidecar emits `binary?: boolean` on conflict hunks; the frontend type has no such field. Binary conflict files will not be identified as binary in the conflict resolver UI.

### P1-4: `MCPServer.restarts` optional/required mismatch

- **Files:** `src/lib/ipc.ts:144`, `sidecar/types.ts:122`
- Sidecar always emits `restarts: number`; frontend types it as `restarts?: number`. Any UI logic checking `server.restarts > 0` will incorrectly treat the value as possibly absent.

### P1-5: `MaverickConfig.mcps` structural mismatch

- **Files:** `src/lib/ipc.ts:245`, `sidecar/types.ts:65`
- Frontend expects `MCPServer[]` (with `status`, `pid`, `restarts`) but sidecar serializes `MCPServerConfig[]` (config-file shape, no runtime state). Config save round-trips will produce unexpected field sets.

### P1-6: `GitProvider` and `RemoteInfo` missing from `sidecar/types.ts`

- **Files:** `src/lib/ipc.ts:261–269`, `sidecar/git-provider.ts:4–14`
- Both types were added to `ipc.ts` but not to `sidecar/types.ts`. The sidecar defines them locally, creating two independent definitions that can drift.

### P1-7: `skills/` panel directory existence unverified

- **Path:** `src/panels/skills/`
- `EditorGroup.tsx` lazy-imports `SkillsPanel` and `SkillEditorPanel` from this directory. If the files are not yet created, the lazy import will throw at runtime when a user navigates to the Skills tab.

---

## Medium Priority Issues (P2)

Issues where the app can function but behavior is suboptimal or fragile.

### P2-1: StatusBar eliminated — token/quota/backend status has no display surface

The 22px bottom strip is gone from `Workbench.tsx`. `useContextUsage` and `useSourceControl` hooks are intact but have no render target. Users have no visibility into token consumption, model quota, or backend connectivity.

### P2-2: NotificationBell eliminated — no unread count indicator

Transient toasts remain functional. There is no persistent notification badge or history count anywhere in the shell.

### P2-3: `ai_commit_message` can exceed sidecar request timeout

- **File:** `src-tauri/src/sidecar.rs:139`
- 60-second timeout is too short for LLM cold-start. Exceeding it creates a zombie `claude -p` subprocess and a silent timeout error on the frontend. Extend the global timeout to at least 120 seconds or make it per-request configurable.

### P2-4: `workspaceGet` always returns `sessionId: ""`

- **File:** `sidecar/sqlite-store.ts` (`workspaceGet` method)
- Inconsistent with `workspaceList` which fetches the real session ID. Any consumer reading `sessionId` from a single-workspace fetch gets stale empty string.

### P2-5: Duplicate `remoteInfo` implementation

- **Files:** `sidecar/git-module.ts:396`, `sidecar/git-provider.ts:90`
- Identical implementations in two classes. The `git.remote_info` RPC handler routes to `GitModule.remoteInfo`, making `GitProviderModule.remoteInfo` dead code.

### P2-6: `workspaceDestroy` manual cascade is fragile

- **File:** `sidecar/sqlite-store.ts` (`workspaceDestroy` method)
- Manual `DELETE` chain instead of `ON DELETE CASCADE`. New FK-linked tables added in future migrations without updating this method will leave orphaned rows.

### P2-7: `kanban.upsert` uses `as never` cast

- **File:** `sidecar/rpc-handlers.ts:676`
- Bypasses type checking on the merged task input object.

### P2-8: `MaverickConfig.project` field absent from `ipc.ts`

- **Files:** `src/lib/ipc.ts`, `sidecar/types.ts`
- `sidecar/types.ts` includes `project?: ProjectSettings` in `MaverickConfig`; `ipc.ts` does not. Silent data loss on the React side when config carries project settings.

### P2-9: 6 Rust remote commands have no frontend wrappers

- **File:** `src/lib/tauri.ts`
- `remote_start`, `remote_stop`, `remote_status`, `remote_pair`, `remote_devices`, `remote_revoke`, and `pty_close_all` are all registered in Rust and `lib.rs` but have zero `invoke()` wrapper functions. They cannot be called from React.

### P2-10: `skills` and `skill-editor` tabs share `Sparkles` icon

- **File:** `src/components/editor/EditorTabs.tsx` (`SYSTEM_TAB_META`)
- Two simultaneously-open skill-related tabs are visually indistinguishable.

### P2-11: Stale comments reference deleted components

Cosmetic only; do not affect compilation or runtime. Affected files:
- `src/test/setup.ts`
- `src/lib/notification-route.ts`
- `src/components/notifications/Toaster.tsx`
- `src/components/editor/terminal/TerminalLeaf.tsx`
- `src/hooks/useSourceControl.ts`

---

## Recommended Fix Order

1. **Remove broken `ActivityBarItem` import** from `src/components/editor/EmptyEditor.reduced.test.tsx` → unblocks `bun run test:coverage` for the entire suite.

2. **Fix Rust `remote_stop`/`remote_status` state type** in `src-tauri/src/commands/remote.rs:27,33` — change `State<'_, RemoteServer>` to `State<'_, Arc<RemoteServer>>` → prevents runtime panic.

3. **Batch-sync IPC type drift** in a single PR:
   - Add `binary?: boolean` to `ConflictHunk` in `src/lib/ipc.ts`
   - Change `MCPServer.restarts` from `restarts?: number` to `restarts: number` in `src/lib/ipc.ts`
   - Reconcile `MaverickConfig.mcps` — decide on one canonical type and update `src/lib/ipc.ts` accordingly
   - Add `GitProvider` and `RemoteInfo` to `sidecar/types.ts` to match `src/lib/ipc.ts`
   - Add `project?: ProjectSettings` to `MaverickConfig` in `src/lib/ipc.ts`

4. **Verify `src/panels/skills/` files exist** or create stubs (`SkillsPanel.tsx`, `SkillEditorPanel.tsx`) that render a placeholder to prevent the lazy import from throwing at runtime.

5. **Fix `activityView` dead state** — either re-wire `PrimarySideBar` to read `activityView` for panel-level view switching, or remove the `setActivityView` calls from `CommandPalette.tsx` and remove the `activityView` field from the store entirely.

6. **Fix sidecar EOF pending drain** — in `src-tauri/src/sidecar.rs:181–184`, iterate pending senders and send `Err(SidecarError::TransportClosed)` before `pending.clear()`.

7. **Verify or restore `⌘⇧T` terminal shortcut** in `src/shortcuts/registry.ts`. If absent, add a `new-terminal` binding pointing to the `useTerminalTab` open handler.

8. **Add frontend wrappers for 6 remote commands + `pty_close_all`** in `src/lib/tauri.ts`.

9. **Extend `ai_commit_message` timeout** to at least 120 seconds or make it per-request configurable.

10. **Fix `workspaceGet` to read real `sessionId`** from the session table (consistent with `workspaceList`).

11. **Remove duplicate `GitProviderModule.remoteInfo`** from `sidecar/git-provider.ts` and route all callers through `GitModule.remoteInfo`.

12. **Design and implement StatusBar replacement.** The underlying hooks (`useContextUsage`, `useSourceControl`) are ready; only the render target needs to be created.
