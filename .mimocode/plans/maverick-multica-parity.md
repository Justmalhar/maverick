# Maverick Bug Fixes + Multica-Inspired Features Plan

## Phase 1: Critical Bug Fixes (P0)

### 1.1 Fix Release Sidecar Path on Windows
- **File**: `src-tauri/src/lib.rs` (~line 99-104)
- **Issue**: Sidecar path resolved one directory ABOVE executable on Windows — every packaged install starts degraded
- **Fix**: Resolve path relative to `std::env::current_exe()` directory, not its parent

### 1.2 Fix Workspace Close PTY Leak
- **File**: `src/state/store.ts` (lines 273-299)
- **Issue**: `removeWorkspace()` kills Run/Setup runners but never calls `killWorkspaceLeaves()` — PTYs orphaned
- **Fix**: Import and call `killWorkspaceLeaves(id)` inside `removeWorkspace`

### 1.3 Fix Kanban Data Loss (3 manifestations)
- **Files**: `src/panels/kanban/KanbanBoard.tsx`, `KanbanTaskDialog.tsx`
- **Issues**: 
  - Start creates workspace but never links it to task (#7)
  - onSend drops description on in_progress transition (#8)
  - Edit dialog drops workspaceId (#9)
- **Fix**: Ensure all callers spread the full task object before upsert

### 1.4 Fix Media Previews on Windows
- **Files**: `src/panels/preview/ImagePreview.tsx`, `VideoPreview.tsx`, `PDFPreview.tsx`
- **Issue**: Raw filesystem paths used as URLs instead of `convertFileSrc()`
- **Fix**: Use Tauri's `convertFileSrc()` for all media previews

## Phase 2: Restore Missing UI Elements (P1)

### 2.1 Restore StatusBar
- **File**: `src/components/workbench/Workbench.tsx`
- **Issue**: StatusBar was removed from layout during refactoring
- **Fix**: Add StatusBar back with: token usage, model quota, backend status, git ahead/behind, error/warning counts
- **Components**: StatusBarItem entries for each metric

### 2.2 Fix Dead CommandPalette Commands
- **File**: `src/components/quickopen/CommandPalette.tsx` (lines 62-132)
- **Issue**: 7 commands call `setActivityView()` which writes to store state nothing reads
- **Fix**: Wire commands to open the actual panels (Kanban, Browser, Git, etc.)

### 2.3 Fix Tab Visual Identity
- **File**: `src/components/editor/EditorTabs.tsx` (SYSTEM_TAB_META)
- **Issue**: `skills` and `skill-editor` tabs both use `Sparkles` icon
- **Fix**: Use distinct icons (e.g., `Sparkles` for skills, `Code` for skill-editor)

## Phase 3: Settings Controls That Actually Work (P2)

### 3.1 Wire Appearance Settings
- **File**: `src/components/editor/terminal/TerminalPane.tsx`
- **Issue**: Font size hardcoded to 13, ligatures hardcoded to false
- **Fix**: Read from `useSettings('appearance.terminalFontSize', 13)` and `useSettings('appearance.ligatures', false)`

### 3.2 Wire Git Settings
- **Files**: Various git-related components
- **Issue**: `git.remote`, `git.template`, `git.autoFetchMinutes`, `git.gpgSign` saved but never read
- **Fix**: Consume these settings in git operations

### 3.3 Wire Notification Preferences
- **File**: Notification-related components
- **Issue**: Per-event toggles saved but never consulted
- **Fix**: Check notification preferences before dispatching

## Phase 4: Multica-Inspired Features

### 4.1 Agent Profiles & Status
- **New component**: `src/components/agents/AgentProfile.tsx`
- **Features**:
  - Agent cards with name, backend, status (active/idle/error), last activity
  - Agent activity timeline (recent commands, files changed)
  - Agent capabilities display (which backends, MCPs available)

### 4.2 Squads (Agent Groups)
- **New component**: `src/components/agents/SquadPanel.tsx`
- **Features**:
  - Group agents under a "leader" agent
  - Assign tasks to squad (leader delegates)
  - Squad member management UI

### 4.3 Task Lifecycle Management
- **Enhanced**: `src/panels/kanban/KanbanBoard.tsx`
- **Features**:
  - Full lifecycle: enqueue → claim → start → complete/fail
  - Real-time progress streaming via WebSocket
  - Blocker reporting from agents
  - Task dependencies and prerequisites

### 4.4 Autopilots (Scheduled Work)
- **New component**: `src/panels/automations/AutopilotPanel.tsx`
- **Features**:
  - Schedule recurring agent tasks (cron triggers)
  - Webhook triggers
  - Manual run triggers
  - Each autopilot creates issue and routes to agent

### 4.5 Enhanced Skills System
- **Enhanced**: `sidecar/skills-engine.ts`
- **Features**:
  - Skill composition (chain multiple skills)
  - Skill versioning
  - Skill sharing across workspaces
  - Skill marketplace integration

### 4.6 Unified Runtime Dashboard
- **New component**: `src/components/runtimes/RuntimeDashboard.tsx`
- **Features**:
  - List all available runtimes (local + cloud)
  - Auto-detect available CLIs
  - Real-time monitoring of runtime status
  - Runtime health checks

## Phase 5: UI/UX Improvements

### 5.1 Glassmorphism Enhancement
- **Files**: `src/styles/globals.css`, various components
- **Enhancement**: Add backdrop-blur + translucent backgrounds to:
  - Sidebar
  - Panels
  - Modals
  - Tooltips
  - Tab bars
  - Input bars
  - Popovers

### 5.2 Responsive Layout
- **File**: `src/hooks/useResponsiveLayout.ts`
- **Enhancement**: 
  - Icon-only mode for sidebar below 900px (instead of hiding completely)
  - Collapsible panels with smooth animations

### 5.3 Keyboard Shortcuts Completion
- **Missing shortcuts**:
  - `Cmd+Alt+Arrow` focus adjacent pane
  - `Cmd+Shift+[/]` cycle terminal panes
  - `Cmd+Shift+= / Cmd+-` per-terminal font size
  - `]c / [c` hunk navigation
  - `Cmd+Shift+A / Cmd+Shift+U` stage/unstage hunk

### 5.4 Notification History
- **File**: `src/components/titlebar/NotificationBell.tsx`
- **Enhancement**: 
  - Persistent notification history panel
  - Unread count badge
  - Click to jump to relevant workspace

### 5.5 Context Usage Display
- **File**: StatusBar components
- **Enhancement**:
  - Real token counting (chars/4)
  - Cost estimation based on model pricing
  - Visual progress bar for context window usage

## Implementation Order

1. **Week 1**: Phase 1 (Critical bug fixes)
2. **Week 2**: Phase 2 (Restore missing UI)
3. **Week 3**: Phase 3 (Settings controls)
4. **Week 4-5**: Phase 4 (Multica features - core)
5. **Week 6**: Phase 5 (UI/UX polish)

## Testing Strategy

- Unit tests for all new components and hooks
- Integration tests for task lifecycle
- E2E tests for critical user flows
- Visual regression tests for UI changes

## Success Metrics

- All P0/P1 bugs fixed
- StatusBar restored and functional
- All settings controls wired
- Agent profiles and squads working
- Task lifecycle fully functional
- Autopilots scheduling working
- Glassmorphism applied throughout
- All keyboard shortcuts implemented
