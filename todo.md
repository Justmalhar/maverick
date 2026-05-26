# Maverick — Implementation Status (v0.1)

> Generated 2026-05-26. Phase-by-phase audit of `PRD.md` + `SYSTEM-DESIGN.md` vs. the actual code in `src/`, `sidecar/`, and `src-tauri/src/`.
> Legend: `[x]` done · `[~]` partial / stubbed · `[ ]` not started.

---

## Phase 0 — Foundation & Scaffolding

- [x] Tauri v2 shell (`src-tauri/src/lib.rs`, `main.rs`, `state.rs`, `sidecar.rs`)
- [x] Bun sidecar JSON-RPC over stdio (`sidecar/index.ts`, `main.ts`, `rpc-handlers.ts`)
- [x] Rust command modules pass-through for every RPC group (`src-tauri/src/commands/*.rs` — 17 modules)
- [x] SQLite migrations 001–004 (`sidecar/migrations/`) — projects, workspaces, sessions, messages, backends, presets, kanban, notifications, context_usage, repo_configs, kanban composer
- [x] React 19 + Vite 6 + Tailwind v4 + shadcn primitives
- [x] Design tokens in `src/styles/tokens.css` + theme-driven `@theme` block in `globals.css`
- [x] `bun run build` + `cargo check` working
- [x] Vitest + jsdom + @testing-library setup; MSW for Tauri `invoke()` mocking (`src/test/setup.ts`)
- [x] Bun test for sidecar; `cargo test` for Rust
- [x] CI coverage thresholds wired (`vitest.config.ts`)
- [ ] `.env.example`, README.md (only `CLAUDE.md`, `PRD.md`, `SYSTEM-DESIGN.md`, `AGENTS.md` exist in repo per CLAUDE.md rules — README + AGENTS.md still missing)

---

## Phase 1 — Workbench Shell (VSCode chrome)

- [x] `Workbench.tsx` root layout with `ResizablePanelGroup`
- [x] `TitleBar` + `TrafficLights` + `Breadcrumb` + `WindowControls`
- [x] `ActivityBar` + `ActivityBarItem` (Projects, Tasks/Kanban, Automations, MCP)
- [x] `PrimarySideBar` with `ProjectsView`, `ProjectItem`, `WorkspaceItem`, `DashboardView`
- [x] `EditorArea` + `EditorGroup` + `EditorTabs` + `EditorTab` + `EmptyEditor`
- [x] `AuxiliaryBar` (right panel) with `FilesView` + `DiffView`
- [x] `Panel` (bottom) with `PanelTabs` — Setup + Run script runner
- [x] `StatusBar` + `StatusBarItem` with branch / sync / errors / warnings / position / encoding / EOL / language / tokens / caffeine / backends / workspaces / notifications
- [x] `CommandPalette` (`⌘⇧P`) + `QuickOpen` (`⌘P`)
- [x] Keep-alive mount + `display:none` for inactive editors (`WorkspaceEditor.tsx`)
- [x] Resizable panels with persisted sizes
- [~] Editor tabs toolbar — design spec exists (`docs/superpowers/specs/2026-05-23-editor-tabs-toolbar-design.md`) + plan, implementation may still be in progress
- [ ] Bottom `Panel` "Terminal" tab (raw PTY shell for the worktree) — only Setup + Run today
- [ ] `WorkspaceBadges` in TitleBar (per `SYSTEM-DESIGN.md` §4.1)
- [ ] Sidebar icon-only collapse < 900px window width
- [ ] LRU suspension after 20+ open workspaces (PTYs preserved, render destroyed)

---

## Phase 2 — Workspace & PTY Core

- [x] `workspace.create` → git worktree + DB row + setup-script execution
- [x] `workspace.destroy` → archive-script + worktree prune
- [x] `workspace.list`
- [x] `pty.spawn` / `pty.write` / `pty.resize` / `pty.kill` (`sidecar/process-manager.ts`)
- [x] `pty:data`, `pty:exit`, `workspace:status` event streaming
- [x] `WorktreeManager` with files-to-copy support
- [x] `useWorkspace` hook + `useWorkbench` Zustand store (`src/state/store.ts`)
- [x] `usePty` hook bridging PTY events to `TerminalProvider`
- [x] Per-repo `maverick.json` (`ProjectSettingsStore` + `sidecar/project-settings.ts`)
- [x] Live-reload project settings on disk change (`onProjectSettingsChanged` event in `Workbench`)
- [ ] `maverick.yaml` schema validation for top-level config (Zod schemas exist but `ConfigLoader` does not enforce — verify)
- [ ] `Cmd+1`–`Cmd+9` jump-to-workspace-by-index
- [ ] Backend status footer health-check (status dot is rendered, but no real ping)

---

## Phase 3 — Editor Modes

### 3.1 Agent Mode
- [x] `AgentView` + `MessageList` + `AgentMessage` + `UserMessage` + `ToolCallSummary`
- [x] `InputBar` with `/skill` autocomplete (textarea + Send button)
- [x] `messages.list` / `messages.append` RPC + SQLite persistence
- [~] Model selector per workspace — backend dropdown exists in some flows, not in `InputBar` itself
- [ ] `@mention` files + `#branch` references in input
- [ ] File-change badges (M/A/D + line counts) on agent responses
- [ ] `⌘F` search in conversation; `⌘⇧C` copy last response

### 3.2 Terminal Mode
- [x] `TerminalView` + `SplitGrid` + `TerminalPane`
- [x] `TerminalProvider` abstraction (`src/lib/terminal-provider.ts`)
- [x] `XtermProvider` (`src/lib/providers/xterm-provider.ts`)
- [x] `GhosttyProvider` stub (`src/lib/providers/ghostty-provider.ts`)
- [x] Binary `SplitNode` tree ops (`src/lib/splitnode.ts`)
- [x] `⌘D` / `⌘⇧D` split shortcuts + `⌘⇧W` close pane + `⌘K` clear
- [x] `⌘T` toggle Agent ↔ Terminal mode
- [ ] `⌘⌥←/→/↑/↓` focus adjacent pane
- [ ] `⌘⇧[` / `⌘⇧]` cycle terminal panes
- [ ] `⌘⇧=` / `⌘-` per-terminal font size

---

## Phase 4 — AuxiliaryBar (right panel)

- [x] `FilesView` — file tree, M/A/D/R indicators (uses `file.tree` RPC)
- [x] `DiffView` — diff2html-style renderer
- [x] `diff.get` / `diff.stage_hunk` / `diff.unstage_hunk` RPC + `DiffReader`
- [~] "AI Code Review" button visible in `DiffView` line 89 — likely stub, not wired to a backend pipeline
- [ ] Hunk navigation `]c` / `[c`
- [ ] `⌘⇧A` / `⌘⇧U` stage / unstage hunk shortcuts

---

## Phase 5 — Project & Repo Settings

- [x] `ProjectSettingsPanel` overlay (`⌘⇧,`) — completed in commit `c81d204`
- [x] Sections: Identity, Preferences, Preview, Scripts, Workspaces
- [x] `project.settings.get` / `update` / `openFile` RPC + disk watcher
- [x] `maverick.json` per-repo config (workspacesPath, baseBranch, remoteOrigin, previewUrl, filesToCopy, scripts, AI prefs)
- [x] Setup script auto-runs on `workspace.create`
- [x] Archive script runs on `workspace.destroy`
- [x] Run script driven by `useScriptRunner` in bottom Panel
- [x] Preview URL with `$MAVERICK_PORT` / `$MAVERICK_WORKSPACE_NAME` substitution (`PreviewSection`)
- [x] AI Preferences fields stored (createPr, codeReview, fixErrors, resolveConflicts, branchStyle, general)
- [ ] AI Preferences actually consumed by any execution path (the fields are written, no consumer yet)

---

## Phase 6 — Theming & Typography

- [x] `ThemeProvider` with VSCode-style color mapping + legacy fallback
- [x] 14 bundled themes (PRD asked for 12):
      Maverick Dark, Maverick Light, GitHub Dark, GitHub Dark Classic, GitHub Light,
      One Dark Pro, Dracula, Nord, Catppuccin Mocha, Catppuccin Latte,
      Tokyo Night, Monokai Pro, Solarized Dark, Gruvbox Dark
- [x] `AppearanceSettings` theme picker + font controls
- [x] CSS custom properties driven by `data-theme` attribute on `<html>`
- [x] Tokens file (`src/styles/tokens.css`) + `globals.css` with `@theme` block
- [x] Geist Mono font bundled (`src/styles/fonts.css`)
- [ ] Geist Mono **Nerd Font** for terminal glyphs/powerline (PRD §5.11) — only base Geist Mono shipped
- [ ] Custom `.maverick-theme.json` import from `~/.maverick/themes/`
- [ ] Glassmorphism (`backdrop-filter` + alpha) applied to chrome — current Warp-style flat tinted background instead of glass per `Workbench.tsx` comment
- [ ] `⌘⇧T` theme picker hotkey

---

## Phase 7 — Skills Engine

- [x] `SkillsEngine` (`sidecar/skills-engine.ts`) — `skills.list` / `skills.run`
- [x] Template variables: `{{file}}`, `{{selection}}`, `{{branch}}`, `{{project}}`, `{{diff}}`
- [x] `useSkills` hook + `/skill-name` autocomplete in `InputBar`
- [x] Skills loaded from `maverick.yaml` via `ConfigLoader`
- [x] `SkillsSettings` UI section
- [ ] Skill chaining via `{{prev}}` (PRD §5.5) — not visible in engine
- [ ] Free-tier 10-skill cap (post-v0.1 monetisation gate)

---

## Phase 8 — Git Module

- [x] `GitPanel` + `BranchList` + `CommitLog` + `StagingArea` + `StashList` + `BlameView` + `ConflictResolver` + `CherryPickDialog`
- [x] `git.log`, `git.stash_list`, `git.commit`, `git.branches`, `git.diffStat` RPC
- [x] `GitModule` sidecar implementation
- [ ] `⌘⇧G` shortcut (registered in `registry.ts` but ActivityBar has no Git icon → opens via palette only)
- [ ] Cherry-pick / rebase full execution flows (dialog exists; runner wiring unclear)
- [ ] Remote ops: fetch / pull / push / set upstream with conflict detection
- [ ] AI Code Review pipeline (`⌘⇧R` action + `gh pr create` chain) — registry has `editor.retry` on `⌘⇧R` instead

---

## Phase 9 — Kanban Board

- [x] `KanbanBoard` + `KanbanColumn` + `KanbanCard` + `KanbanTaskDialog` + `ProjectFilterTabs` + `TaskComposer`
- [x] `kanban.list` / `kanban.upsert` RPC + `kanban_tasks` table
- [x] Default columns: Backlog → In Progress → Review → Done
- [x] Task composer (per `MEMORY.md` — Kanban Composer feature shipped 2026-05-22)
- [x] Drag-and-drop columns via `@hello-pangea/dnd`
- [ ] "Start in Maverick" → seed new workspace with task description as initial prompt
- [ ] Import from GitHub Issues / Linear / plaintext
- [ ] Export to markdown checklist / GitHub Issues
- [ ] Keyboard accessible reorder (`M` then arrows)

---

## Phase 10 — Browser Panel

- [x] `BrowserPanel` + `BrowserToolbar` + `ElementInspector`
- [x] URL bar with back / forward / refresh / stop
- [x] In-app history stack
- [~] Element inspector overlay — `ElementInspector.tsx` exists; cross-origin iframe element capture is fundamentally limited (PRD specified Tauri `WebviewWindow` but implementation uses `<iframe>`)
- [ ] `WebviewWindow` migration (PRD §5.15) — required for real element capture
- [ ] `⌘⇧I` WYSIWYG toggle
- [ ] Captured element → input bar context injection

---

## Phase 11 — Workspace Presets

- [x] `PresetPicker` (`⌘⇧Space`) + `PresetEditor` + `PresetForm` + `PresetThumbnail`
- [x] `preset.list` / `preset.launch` / `preset.save_current` RPC
- [x] `PresetLauncher` sidecar — worktree + PTY spawn sequence
- [x] Template vars: `{{workspace_root}}`, `{{project_name}}`, `{{branch}}`, `{{workspace_name}}`, `{{home}}`
- [x] Global + per-repo preset storage (`workspace_presets` table)
- [x] `usePresets` hook
- [ ] "Save current layout as preset" right-click action on workspace tab
- [ ] Browser pane node in preset launcher

---

## Phase 12 — Automations

- [x] `AutomationsPanel` + `AutomationBuilder` + `AutomationRunner` + `StepEditor`
- [x] `automation.run` RPC + `AutomationRunner` sidecar
- [x] Step types: shell, skill, git (per `sidecar/automation-runner.ts` — verify)
- [x] Loaded from `maverick.yaml` `automations:` key
- [ ] `trigger: schedule` (cron) and `trigger: on-file-change` (fs watcher) — only manual today
- [ ] Step types: create workspace, send notification, open URL
- [ ] Global automations file `~/.maverick/automations.yaml`

---

## Phase 13 — MCP Servers

- [x] `MCPsPanel` + `MCPServerCard` + `AddMCPDialog`
- [x] `mcp.start` / `mcp.stop` / `mcp.list` RPC + `MCPManager` sidecar
- [x] `MCPsSettings` settings section
- [x] Per-project + global MCP definitions via `maverick.yaml`
- [ ] Server logs viewer ("click → opens in a terminal pane")
- [ ] Health monitoring + auto-restart on crash
- [ ] Bundled MCP presets (filesystem, git, sqlite, fetch, puppeteer)

---

## Phase 14 — File Previewers

- [x] `FilePreviewPanel` MIME router
- [x] `MarkdownPreview` (react-markdown + remark-gfm + highlight.js)
- [x] `PDFPreview` (pdfjs-dist)
- [x] `ImagePreview`
- [x] `VideoPreview`
- [x] `RawPreview` (text/hex fallback)
- [ ] `⌘⇧M` toggle raw / preview for Markdown
- [ ] `⌘⇧V` dedicated center-panel preview tab
- [ ] Click in file tree → opens preview slide-over

---

## Phase 15 — Notifications, Quota, Caffeinate

- [x] `NotificationService` sidecar + `notify.send` RPC
- [x] `notifications` table
- [x] `NotificationsSettings` section
- [x] `ContextTracker` sidecar + `context.usage` RPC + `context_usage` table
- [x] `UsagePanel` UI shell (placeholder data — wired comment explicitly states "Data placeholders today")
- [x] `Caffeinate` sidecar class with darwin / linux branches
- [ ] **Notification bell with history** in StatusBar — current item shows static `"v0.1"` instead
- [ ] OS native notification dispatch (Tauri notification plugin not installed in `package.json`)
- [ ] In-app toast notifications
- [ ] `Caffeinate` RPC binding (`sidecar/rpc-handlers.ts` does not expose `caffeinate.start/stop`)
- [ ] StatusBar `caffeinate` item is non-interactive (static "caffeinate" label, no toggle)
- [ ] `Settings → Advanced → Caffeinate while agents running` (toggle exists in settings but no real wiring)
- [ ] Per-event quota warning notifications (80% / 100%)
- [ ] Real context-usage data — token counter, cost estimate, model-pricing config
- [ ] Per-backend quota tracker (requests/min, requests/day) — `UsagePanel` shows zeros from `backends` map only
- [ ] Windows caffeinate via `SetThreadExecutionState` FFI

---

## Phase 16 — Conductor Parity Features

- [x] Repository Settings (delivered as Project Settings overlay)
- [x] AI Preferences fields (review_prefs / pr_prefs / branch style / general)
- [x] `attachment.create` RPC + `AttachmentStore` sidecar
- [ ] **Auto-convert long text** in `InputBar` — paste > 5,000 chars → `@attachment:` ref. Today `InputBar.tsx` ignores paste size; `AttachmentStore` is never invoked from UI
- [ ] **MAVERICK.md instruction file** — auto-prepended to every prompt. No reference anywhere in `src/` or `sidecar/`
- [ ] Fallback chain MAVERICK.md → CLAUDE.md → AGENTS.md → none
- [ ] `~/.maverick/GLOBAL.md` cross-repo instructions
- [ ] **AI PR Review** workflow — `⌘⇧R` is bound to `editor.retry`; no diff → backend → `gh pr create` chain anywhere
- [ ] "Create PR" one-click action (consumes `createPr` AI pref)

---

## Phase 17 — Distribution & Polish

- [ ] `getmaverick.sh` curl installer (platform detection, macOS / Linux / Windows)
- [ ] macOS `.dmg` bundle + universal arm64+x86_64 binary
- [ ] Linux `.AppImage` / `.deb`
- [ ] Windows `.msi` installer
- [ ] Auto-update check on launch (GitHub releases API, delta updates)
- [ ] Update channel selector (stable / beta) — `AccountSettings` section missing
- [ ] Telemetry opt-out plumbing (toggle stub in AdvancedSettings only)
- [ ] License key + plan info (post-v0.1)

---

## Phase 18 — Testing & Coverage

- [x] 278 test files across React (`*.test.tsx`), sidecar (`bun test`), Rust (`cargo test`)
- [x] `bun run test:coverage` exists; thresholds `100/95/100/100` per `CLAUDE.md`
- [x] Recent "100% line/func/stmt + 95%+ branch coverage" commit (`f94285b`)
- [ ] Playwright E2E golden-path CI nightly (config not present)
- [ ] CI workflow file (no `.github/workflows/` directory)

---

## Phase 19 — Settings UI Sections

- [x] General
- [x] Models
- [x] Providers
- [x] Appearance
- [x] Notifications
- [x] Keybindings
- [x] Git
- [x] MCPs
- [x] Advanced
- [x] Terminal Presets
- [x] Skills
- [x] Version (custom — not in PRD)
- [ ] Environment (global env vars injected into all PTYs)
- [ ] Account (license, plan, update channel)
- [ ] Repositories — replaced by per-project overlay (`ProjectSettingsPanel`); the PRD's nested section inside Settings is intentionally not built

---

## Top-priority gaps to close before "v0.1 done"

1. **Notification bell UI + Tauri notification plugin** (Phase 15) — currently a static `v0.1` label.
2. **Caffeinate RPC + toggle wiring** (Phase 15) — backend exists, UI cannot turn it on.
3. **Context tracker live wiring** (Phase 15) — `UsagePanel` and StatusBar `0 tokens` are placeholders.
4. **Auto-convert paste > 5000 chars** in `InputBar` (Phase 16) — `AttachmentStore` is orphaned.
5. **MAVERICK.md instruction-file injection** (Phase 16) — not implemented.
6. **AI PR Review pipeline** (`⌘⇧R` + `gh pr create`) (Phase 16) — shortcut collides with `editor.retry`.
7. **Bottom Panel "Terminal" tab** (Phase 1) — only Setup + Run present.
8. **Workspace LRU suspension + `⌘1`–`⌘9` jumps** (Phase 1/2).
9. **Browser → real `WebviewWindow`** (Phase 10) — iframe blocks element capture.
10. **Distribution installers + auto-update** (Phase 17).

---

*Source of truth: `PRD.md` (v0.1, 2026-05-20), `SYSTEM-DESIGN.md` (2026-05-20), and the codebase as of commit `c81d204` on `main`.*
