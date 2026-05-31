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
- [x] Bottom `Panel` "Terminal" tab (raw PTY shell for the worktree) — `BottomTerminal` spawns `/bin/zsh -l` in the worktree; sidecar `pty.spawn` defaults cwd to worktreePath
- [ ] `WorkspaceBadges` in TitleBar (per `SYSTEM-DESIGN.md` §4.1)
- [ ] Sidebar icon-only collapse < 900px window width
- [x] LRU suspension beyond `advanced.lruLimit` open workspaces — store tracks MRU access order; `computeLiveWorkspaceIds` keeps the active + most-recent N rendered, suspends the rest (DOM destroyed, sidecar PTYs preserved, reconnect on re-focus)

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
- [x] `Cmd+1`–`Cmd+9` jump-to-workspace-by-index (wired in `useShortcuts.ts`; now also surfaced in `registry.ts` for Settings/Command Palette discovery)
- [ ] Backend status footer health-check (status dot is rendered, but no real ping)

---

## Phase 3 — Editor Modes

### 3.1 Agent Mode
- [x] **Real PTY backend (Rust `portable-pty`)** — `PtyManager` owns OS pseudo-terminals; `pty_spawn/write/resize/kill` rewritten to use it (reader thread → `pty:data`, waiter → `pty:exit`). Bun sidecar no longer hosts terminals (node-pty fails under Bun; Bun.spawn is pipe-only). ⚠️ runtime-verify live.
- [x] **`AgentTerminal`** — workspace agent mode now spawns the backend CLI (`claude`) as a live PTY in the worktree and renders it via xterm.js, replacing the chat bubbles. PTY cached per workspace (survives tab switches). Chat `AgentView` retained but no longer the default editor view.
- [x] `AgentView` + `MessageList` + `AgentMessage` + `UserMessage` + `ToolCallSummary` (retained; superseded by AgentTerminal as the default)
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
- [x] "AI Code Review" button in `DiffView` — wired to `runAiReview` (diff → prompt → agent PTY); "Create PR" button wired to `pr.create`
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
- [x] AI Code Review pipeline (`⌘⇧R` action + `gh pr create` chain) — `ai.review` action + `pr.create` RPC (`GitModule.prCreate`) now wired

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

- [x] `BrowserPanel` + `BrowserToolbar` (now native-webview driven; iframe `ElementInspector` removed)
- [x] URL bar with back / forward / refresh / stop — drive the native webview via `browser_navigate` / `browser_eval`
- [x] In-app history stack
- [x] Element inspector — injected `__mvInspect` script in the native webview emits `browser://captured`; cross-origin now works (script runs inside the target page)
- [x] **`WebviewWindow` migration (PRD §5.15)** — embedded child webview via Tauri `unstable` `window.add_child`, pinned to the panel rect (`browser_open/navigate/set_bounds/show/hide/close/eval`), hidden under modal overlays, closed on unmount. ⚠️ **Compiles + React fully tested; native runtime behavior must be verified live** (`bun run tauri dev`) — geometry sync, hide-on-overlay, and the capture event channel are runtime-only.
- [x] Captured element → input bar context injection (`maverick:input-append`)
- [ ] `⌘⇧I` WYSIWYG toggle — inspect toggle is in the toolbar; the `⌘⇧I` keybinding is not yet registered

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
- [x] **Notification bell with history** in StatusBar — `NotificationBell` with unread badge + popover list + mark-read; `notify.list/markRead/markAllRead/unreadCount` RPC; `notification.send` now persists to DB and live-updates the bell
- [x] OS native notification dispatch — `dispatchOsNotification` via `@tauri-apps/plugin-notification` (plugin + capabilities already wired); fired from the global `Toaster` on every `notification:send`
- [x] In-app toast notifications — `Toaster` (radix-toast) mounted in `Workbench`, renders toasts from `notification:send` events with auto-dismiss + queue cap
- [x] `Caffeinate` RPC binding — `caffeinate.start/stop/status` in sidecar + Rust commands + React wrappers
- [x] StatusBar `caffeinate` item is non-interactive — replaced with interactive `CaffeinateToggle` (awake/caffeinate states, aria-pressed)
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
- [x] **Auto-convert long text** in `InputBar` — paste > `advanced.largeTextThreshold` (default 5,000) chars now calls `attachment.create`, inserts `@attachment:<ref>` at the caret, and renders a removable chip with the char count
- [x] **MAVERICK.md instruction file** — `InstructionsResolver` + `instructions.resolve` RPC; `AgentView` prepends resolved instructions to the first prompt of a fresh session (visible/persisted message stays clean)
- [x] Fallback chain MAVERICK.md → CLAUDE.md → AGENTS.md → none (HTML comments stripped; empty files skip to next candidate)
- [x] `~/.maverick/MAVERICK.md` cross-repo (global) instructions — prepended ahead of project-local instructions
- [x] **AI PR Review** workflow — `⌘⇧R` rebound from the `editor.retry` stub to `ai.review`; `runAiReview` builds a diff-aware prompt (honoring the project `review` pref) and pipes it to the agent PTY; DiffView "AI Code Review" button wired to the same path
- [x] "Create PR" one-click action — `pr.create` RPC pushes the branch + runs `gh pr create --fill`; DiffView button confirms, shows the resulting PR URL or error

---

## Phase 17 — Distribution & Polish

- [x] `getmaverick.sh` curl installer (platform + arch detection, macOS / Linux / Windows; configurable `MAVERICK_REPO`/`MAVERICK_VERSION`)
- [x] macOS `.dmg` / Linux `.AppImage`+`.deb` / Windows `.msi` — `bundle.targets: "all"` + installer metadata (category, descriptions, publisher, copyright, macOS min version, deb deps). Requires `bun run tauri:build` per platform; universal macOS binary needs a `--target universal-apple-darwin` build.
- [ ] Auto-update check on launch — NOT enabled (needs decision): generate a signer keypair (`bunx tauri signer generate`), add `tauri-plugin-updater` + `@tauri-apps/plugin-updater` + `updater:default` capability, set `plugin.updater.pubkey` + endpoint (e.g. GitHub releases `latest.json`), and `bundle.createUpdaterArtifacts: true`. Left off to avoid a half-configured update channel.
- [ ] Update channel selector (stable / beta) — `AccountSettings` section missing
- [ ] Telemetry opt-out plumbing (toggle stub in AdvancedSettings only)
- [ ] License key + plan info (post-v0.1)

---

## Phase 18 — Testing & Coverage

- [x] 278 test files across React (`*.test.tsx`), sidecar (`bun test`), Rust (`cargo test`)
- [x] `bun run test:coverage` exists; thresholds `100/95/100/100` per `CLAUDE.md`
- [x] Recent "100% line/func/stmt + 95%+ branch coverage" commit (`f94285b`)
- [x] Playwright E2E golden-path — `playwright.config.ts` + `e2e/golden-path.spec.ts` (boot smoke); `@playwright/test` devDep + `test:e2e` script; runs via `.github/workflows/e2e-nightly.yml`. (Full Tauri-runtime E2E via tauri-driver is future work.)
- [x] CI workflow file — `.github/workflows/ci.yml` (frontend typecheck+coverage, sidecar bun test, rust cargo test) + nightly E2E workflow

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

1. ~~**Notification bell UI**~~ ✅ done — `NotificationBell` with unread badge, popover history, mark-read; DB-persisted + live events. (Tauri OS-native notification plugin dispatch still open.)
2. ~~**Caffeinate RPC + toggle wiring**~~ ✅ done — `caffeinate.start/stop/status` + interactive `CaffeinateToggle`.
3. **Context tracker live wiring** (Phase 15) — `UsagePanel` and StatusBar `0 tokens` are still placeholders.
4. ~~**Auto-convert paste > 5000 chars**~~ ✅ done — paste → `attachment.create` → `@attachment:` chip in `InputBar`.
5. ~~**MAVERICK.md instruction-file injection**~~ ✅ done — `InstructionsResolver` + first-prompt injection with MAVERICK.md → CLAUDE.md → AGENTS.md fallback and global file.
6. ~~**AI PR Review pipeline**~~ ✅ done — `⌘⇧R` → `ai.review`; `runAiReview` diff→prompt→PTY; `pr.create` (`gh pr create`) wired to DiffView.
7. ~~**Bottom Panel "Terminal" tab**~~ ✅ done — `BottomTerminal` raw shell scoped to the worktree.
8. ~~**Workspace LRU suspension + `⌘1`–`⌘9` jumps**~~ ✅ done — access-order LRU window + index-jump shortcuts surfaced in the registry.
9. ~~**Browser → real `WebviewWindow`**~~ ✅ done — embedded child webview (Tauri `unstable`); injected capture script unblocks cross-origin. Compiles + React tested; live runtime verification pending.
10. **Distribution installers + auto-update** (Phase 17) — ✅ bundle metadata + `getmaverick.sh`; auto-update still needs a signing key + release endpoint.

### Remaining for v0.1
- ~~Context-usage live data~~ ✅ done — `context.record` RPC + `useContextUsage` hook; StatusBar shows `~tok · $cost` for the active session; UsagePanel aggregates real per-backend usage; AgentView records estimated tokens (chars/4 + per-backend pricing) on load + each prompt.
- ~~OS-native notification dispatch + in-app toasts~~ ✅ done — `Toaster` + `dispatchOsNotification` wired to `notification:send`.
- ~~Browser `WebviewWindow` migration~~ ✅ done — embedded child webview (Tauri `unstable`); compiles + React tested; **needs live runtime verification**.
- Distribution: ✅ bundle metadata + `getmaverick.sh` done; **auto-update still open** — needs a signing keypair + release endpoint (your decision).
- ~~CI workflow + Playwright E2E nightly~~ ✅ done — `.github/workflows/ci.yml` + `e2e-nightly.yml` + Playwright golden-path scaffold.
- ~~README.md + AGENTS.md at repo root~~ ✅ done (Phase 0).

---

*Source of truth: `PRD.md` (v0.1, 2026-05-20), `SYSTEM-DESIGN.md` (2026-05-20). Updated 2026-05-27 after closing the worktree-create regression + 8 feature gaps.*
