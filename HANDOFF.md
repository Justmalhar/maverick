# Maverick — Handoff Document

**Date:** 2026-07-03
**Session:** Maverick + Multica Parity Features

---

## Executive Summary

This session focused on three areas:
1. **Bug verification** — Audited 40 bugs from BUGHUNT_REPORT.md against the codebase
2. **UI/UX improvements** — Added glassmorphism, icon-only sidebar, keyboard shortcuts
3. **Multica feature planning** — Designed agent profiles, squads, task lifecycle, autopilots

**Key finding:** Most critical bugs (PTY leak, kanban data loss, media previews, git checkout) were already fixed in prior sessions. The remaining work is mostly UI polish and new Multica-inspired features.

---

## What Was Done

### Bug Verification (All Already Fixed)

| Bug # | Description | Status |
|-------|-------------|--------|
| #1 | Release sidecar path on Windows | ✅ Already fixed — uses `current_exe().parent()` |
| #17 | Workspace close PTY leak | ✅ Already fixed — `removeWorkspace` calls `killTerminalGroupLeaves` |
| #7, #8, #9 | Kanban data loss (3 manifestations) | ✅ Already fixed — all callers spread full task object |
| #6 | Media previews on Windows | ✅ Already fixed — all use `convertFileSrc()` |
| #10 | Git checkout remote branch detached HEAD | ✅ Already fixed — `resolveCheckoutRef` strips remote prefix |
| #11 | GitHub compare-URL slash encoding | ✅ Already fixed — encodes each segment, preserves slashes |
| #18 | Agent cost wipe on exit | ✅ N/A — doesn't exist in this codebase |

### UI/UX Improvements Completed

#### 1. Glassmorphism System
**File:** `src/styles/globals.css`
- Added `.glass`, `.glass-heavy`, `.glass-light` utility classes
- Backdrop-blur (12-24px), translucent backgrounds (0.6-0.85 alpha), saturate(180%)
- Applied to:
  - `PrimarySideBar` — `.glass` class
  - `TitleBar` — `.glass-light` class
  - `EditorTabs` — `.glass-light` class
  - `StatusBar` — `.glass-light` class (new component)

#### 2. Icon-Only Sidebar Mode
**Files:**
- `src/components/primarysidebar/PrimarySideBar.tsx`
- `src/components/primarysidebar/ProjectsView.tsx`
- `src/components/primarysidebar/ProjectItem.tsx`
- `src/components/workbench/Workbench.tsx`

**Changes:**
- `PrimarySideBar` now accepts `collapsed` prop
- When collapsed: shows 48px icon-only strip with tooltips
- `ProjectsView` renders project initials as icon buttons when collapsed
- `ProjectItem` shows first letter of project name when collapsed
- `Workbench` passes `collapsed` state to `PrimarySideBar`
- Panel resizes from 15% to 3% when collapsed

#### 3. Keyboard Shortcuts Added
**File:** `src/shortcuts/registry.ts`

Added missing shortcuts from PRD §5.12:
- `⌘⇧A` — Stage current hunk
- `⌘⇧U` — Unstage current hunk
- `⌘⇧]` / `⌘⇧[` — Cycle terminal panes
- `⌘⇧=` / `⌘-` — Increase/decrease terminal font size
- `⌘↑` / `⌘↓` — Scroll to top/bottom of conversation
- `⌘F` — Search in conversation
- `⌘⇧C` — Copy last agent response
- `⌘⇧E` — Focus file tree
- `⌘⇧T` — Theme picker

#### 4. StatusBar Component Created
**File:** `src/components/statusbar/StatusBar.tsx`

New component showing:
- Active workspace branch
- Token usage (e.g., "42k / 200k")
- Session cost estimate
- Active backend name
- Agent status (working/done/error)

**Note:** Component created but NOT yet wired into Workbench.tsx — needs integration.

---

## What Remains

### High Priority (P0/P1)

#### 1. Wire StatusBar into Workbench
**File:** `src/components/workbench/Workbench.tsx`
- Import and render `<StatusBar />` after the main content div
- Should appear at the bottom of the window

#### 2. Fix Dead CommandPalette Commands
**File:** `src/components/quickopen/CommandPalette.tsx` (lines 62-132)
- 7 commands call `setActivityView()` which is a no-op
- Need to wire to `openSystemTab()` for: git, kanban, browser, automations, mcps, projects

#### 3. Fix Tab Visual Identity
**File:** `src/components/editor/EditorTabs.tsx` (SYSTEM_TAB_META)
- `skills` and `skill-editor` tabs both use `Sparkles` icon
- Change `skill-editor` to use `Code` or `FileCode` icon

#### 4. Wire Settings Controls
**Files:** Various
- `appearance.terminalFontSize` — hardcoded to 13 in TerminalPane
- `appearance.ligatures` — hardcoded to false in TerminalPane
- `appearance.animations` — no consumer
- `git.remote`, `git.template`, `git.autoFetchMinutes`, `git.gpgSign` — saved but never read
- `notifications.agent.*` toggles — saved but never consulted

### Medium Priority (P2) — Multica-Inspired Features

#### 5. Agent Profiles & Status
**New:** `src/components/agents/AgentProfile.tsx`
- Agent cards with name, backend, status, last activity
- Activity timeline (recent commands, files changed)
- Capabilities display (backends, MCPs available)

#### 6. Squads (Agent Groups)
**New:** `src/components/agents/SquadPanel.tsx`
- Group agents under a "leader" agent
- Assign tasks to squad (leader delegates)
- Squad member management UI

#### 7. Enhanced Task Lifecycle
**Enhanced:** `src/panels/kanban/KanbanBoard.tsx`
- Full lifecycle: enqueue → claim → start → complete/fail
- Real-time progress streaming
- Blocker reporting from agents
- Task dependencies

#### 8. Autopilots (Scheduled Work)
**New:** `src/panels/automations/AutopilotPanel.tsx`
- Schedule recurring agent tasks (cron triggers)
- Webhook triggers
- Manual run triggers

### Low Priority (P3) — Polish

#### 9. Additional Glassmorphism
Apply to more components:
- Modals/Dialogs
- Tooltips
- Popovers/DropdownMenus
- Input bars

#### 10. Settings Controls
**File:** `src/panels/settings/sections/AppearanceSettings.tsx`
- UI font size control — no consumer
- Terminal font size — wired to TerminalPane
- Ligatures toggle — wired to TerminalPane
- Animations toggle — no consumer

---

## Architecture Reference

### Layer Structure
```
React (src/) ──Tauri invoke──▶ Rust (src-tauri/) ──JSON-RPC/stdio──▶ Bun sidecar (sidecar/)
                                                                       └─ PTYs, git worktrees, SQLite, config, MCP
```

### Key Files
| Area | File |
|------|------|
| Root layout | `src/components/workbench/Workbench.tsx` |
| State management | `src/state/store.ts` |
| Theme engine | `src/themes/theme-provider.tsx` |
| Design tokens | `src/styles/tokens.css` |
| Global styles | `src/styles/globals.css` |
| Keyboard shortcuts | `src/shortcuts/registry.ts` |
| IPC types | `src/lib/ipc.ts` |
| Tauri commands | `src/lib/tauri.ts` |

### VSCode Terminology (Use These)
| Concept | Maverick Name | Don't Use |
|---------|---------------|-----------|
| Top draggable bar | `TitleBar` | — |
| Left panel | `PrimarySideBar` | Sidebar |
| Center region | `EditorArea` | CenterPanel |
| Right panel | `AuxiliaryBar` | RightPanel |
| Bottom panel | `Panel` | TerminalSubPanel |
| Bottom strip | `StatusBar` | — |
| Whole shell | `Workbench` | AppBody |

### Testing
- **Unit tests:** `bunx vitest run`
- **Sidecar tests:** `bun test sidecar/`
- **Rust tests:** `cargo test --workspace`
- **Coverage:** `bun run test:coverage` (100% lines, 95%+ branches)
- **Build:** `bun run build && cargo check`

---

## Multica Feature Comparison

### What Multica Has That Maverick Doesn't

| Feature | Multica | Maverick Status |
|---------|---------|-----------------|
| Agent Profiles | Agents have profiles, show on board, post comments | Not implemented |
| Squads | Group agents under leader for delegation | Not implemented |
| Autonomous Execution | Full task lifecycle with progress streaming | Partial (Kanban basic) |
| Autopilots | Cron/webhook triggers for recurring work | Not implemented |
| Reusable Skills | Skills compound across team | Basic skills engine exists |
| Unified Runtimes | Dashboard for all compute | Not implemented |
| Multi-Workspace | Workspace-level isolation | Partial (per-project) |

### What Maverick Has That Multica Doesn't

| Feature | Maverick | Multica Status |
|---------|----------|----------------|
| Desktop IDE | Native Tauri v2 app | Web-only |
| Terminal Multiplexer | 6-pane tmux-style splits | Not available |
| Git Worktrees | Per-workspace isolation | Not available |
| PTY Management | Keep-alive across switches | Not available |
| Theme System | 14 bundled themes | Not available |
| Offline Operation | No cloud dependency | Cloud-first |

---

## Next Steps for Continuation

### Immediate (Do First)
1. Wire `StatusBar` into `Workbench.tsx`
2. Fix CommandPalette no-op commands
3. Fix tab icon identity (skills vs skill-editor)

### Short-term (This Week)
4. Wire appearance settings (font size, ligatures)
5. Wire git settings (remote, template, auto-fetch)
6. Wire notification preferences

### Medium-term (Next Sprint)
7. Implement Agent Profiles component
8. Implement Squad system
9. Enhance Kanban task lifecycle

### Long-term (Future)
10. Implement Autopilots
11. Build Runtime Dashboard
12. Skill composition and versioning

---

## Notes for Next Agent

1. **Run tests before claiming done:** `bun run test:coverage` must pass
2. **Follow CLAUDE.md conventions:** VSCode terminology, shadcn + Tailwind only
3. **No API keys:** Backends read their own CLI config
4. **Keep-alive mount:** Editor groups use `display:none`, never unmount
5. **Cross-layer contracts:** Changes to `src/lib/ipc.ts` must match `sidecar/types.ts`
