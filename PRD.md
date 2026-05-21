# Maverick — Product Requirements Document

**Version:** 0.1  
**Author:** Malhar Ujawane  
**Last Updated:** 2026-05-20  
**Status:** Draft

---

## 1. Problem Statement

Developers using AI coding CLIs (Claude Code, Codex, Gemini CLI, Aider) manage each in separate terminal windows with no shared project context, no parallel execution visibility, and no unified workflow. Switching between agents means losing context. Running agents in parallel means juggling terminals manually.

Maverick is the OS layer above all CLI agents — a native desktop IDE where the terminal is the primary interface, not a secondary panel.

---

## 2. Goals

| Goal | Metric |
|---|---|
| Unified multi-agent workspace | Run up to 6 CLI agents in parallel, visible in a single window |
| Zero inference cost | Maverick never calls AI APIs — only spawns CLI subprocesses |
| Fast workspace switching | `Cmd+[/]` switching < 10ms (keep-alive PTYs) |
| Per-repo reproducibility | `maverick.yaml` committed to version control |
| Git isolation | Every agent run in its own `git worktree` |
| Cross-platform | macOS arm64/x86_64, Windows x64, Linux x64/arm64 — single codebase |
| Native OS feel | Tauri v2, native window chrome, < 15MB binary |

---

## 3. Non-Goals (v0.1)

- Maverick does not proxy or modify AI API calls
- No cloud sync or team collaboration in v0.1
- No auth, billing, or subscription management
- No specific terminal renderer lock-in — `TerminalProvider` abstraction used from day one; xterm.js is the default implementation

---

## 4. Users

**Primary:** Staff/senior software engineers running multiple AI coding tools daily. Comfortable with the terminal. Owns multiple AI subscriptions (Claude Pro, Codex, Gemini Advanced).

**Secondary:** Engineering leads who want reproducible AI workflows committed to repos (`maverick.yaml`).

---

## 5. Features

### 5.1 Project & Workspace Management

- **Projects sidebar:** List of local repos. Each project expandable to show active workspaces.
- **Workspace:** A branch + agent backend combo. Each workspace = isolated `git worktree` + PTY process.
- **Workspace switcher:** `Cmd+[` / `Cmd+]`. All WorkspacePanels mounted in DOM, `display:none` when inactive. PTYs never killed on switch.
- **Add workspace:** Pick a project → pick a branch (or create) → pick an agent backend → spawns worktree + PTY.
- **LRU suspension:** After 20+ open workspaces, oldest render surfaces destroyed (PTY processes preserved).

### 5.2 Agent Mode (Center Panel)

- Conversation history per workspace (stored in SQLite).
- Tool call summaries (collapsible: "6 tool calls, 6 messages").
- File change badges on agent responses (M/A/D + line counts).
- Input bar: free-text prompt, `@mention` files, `#branch` references, `/commands`.
- Model selector per workspace (propagated to CLI via args).

### 5.3 Terminal Mode (Center Panel — `⌘T` toggle)

- Up to **6 terminal panes** in a 3×2 grid.
- Binary **SplitNode tree** model (same as tmux internals).
- Split shortcuts: `⌘D` horizontal, `⌘⇧D` vertical. Close pane: `⌘W`.
- Active pane highlighted with accent color. Click to focus.
- Each pane is a live PTY connected to the workspace's CLI process.
- `⌘T` toggles back to Agent mode — panes stay alive.
- **Terminal renderer is pluggable** via `TerminalProvider` interface — xterm.js ships as the default; swappable to Ghostty, native OS terminal, or custom renderer without code changes outside the provider. Renderer configured in `Settings → Terminal → Renderer`.

### 5.4 Diff Viewer (Right Panel — Changes Tab)

- Unified or split diff view for the active workspace's `git worktree`.
- Syntax-highlighted line diffs using `diff2html` or equivalent.
- File-level summary: total insertions / deletions, file status (M/A/D/R).
- Click a changed file in the file tree → opens its diff inline.
- Hunk-level navigation: `]c` / `[c` to jump between hunks.
- Stage / unstage individual hunks directly from the diff view (via `git apply --cached`).
- Read-only in v0.1 (no inline editing); stage/unstage actions only.

### 5.5 YAML Skills Engine

- Skills are reusable prompt templates defined in `maverick.yaml` under the `skills:` key.
- Each skill has: `name`, `description`, `prompt` (templated string), optional `backend` override.
- Skills are invoked from the input bar via `/skill-name` or the `@skills` picker.
- Template variables: `{{file}}`, `{{selection}}`, `{{branch}}`, `{{project}}`, `{{diff}}`.
- Skills can chain: output of one skill passed as `{{prev}}` to the next.
- Free tier: up to 10 skills per repo. Pro: unlimited.

Example:
```yaml
skills:
  - name: review
    description: Code review for the current diff
    prompt: "Review this diff for bugs and style issues:\n{{diff}}"
  - name: explain
    description: Explain selected code
    prompt: "Explain this code clearly:\n{{selection}}"
    backend: gemini
```

### 5.6 File Tree (Right Panel)

- Displays working tree of active workspace's `git worktree`.
- File status indicators: `M` (modified, amber), `A` (added, green), `D` (deleted, red), `R` (renamed, blue).
- Click to open file in default editor (passes path to `$EDITOR`).
- **Tabs:** All files | Changes | Checks (checks stub in v0.1).

### 5.7 Integrated Terminal Sub-Panel (Right Panel, Bottom)

- **Setup tab:** Run setup commands defined in `maverick.yaml`.
- **Run tab:** Process output stream (stdout/stderr of dev server, test runner, etc.).
- **Terminal tab:** Raw PTY shell for the workspace worktree.

### 5.8 Backend Management

- Supported backends in v0.1: `claude-code`, `codex`, `gemini`, `aider`, `ollama`, `custom`.
- Backend status footer in sidebar: green dot (active), grey dot (idle), red dot (error).
- Backend config in `maverick.yaml` — command, args, env vars.
- Custom backends: any CLI command that reads from stdin / writes to stdout.

### 5.9 Configuration

**`maverick.yaml`** (required, per-repo, committed to VCS):
```yaml
version: 1
backends:
  default: claude-code
  available:
    - name: claude-code
      command: claude
      args: []
    - name: codex
      command: codex
      args: []
    - name: gemini
      command: gemini
      args: [--yolo]
worktrees:
  base: .maverick/worktrees
```

**`maverick.json`** (optional, per-repo, team-shareable):
```json
{
  "scripts": {
    "setup": "bun install",
    "dev": "bun run dev",
    "test": "bun test"
  },
  "preferences": {
    "defaultLayout": "agent",
    "maxWorkspaces": 6
  }
}
```

### 5.10 Theme System

- Built-in themes bundled with the app — no internet required.
- **Included themes:** Maverick Dark (default), One Dark Pro, Dracula, Nord, Catppuccin Mocha, Catppuccin Latte (light), Tokyo Night, Monokai Pro, GitHub Dark, GitHub Light, Solarized Dark, Gruvbox Dark.
- Themes apply to: UI chrome, terminal (xterm.js color scheme), diff viewer, syntax highlights.
- Theme picker accessible from: `Settings → Appearance → Theme` or `⌘⇧T`.
- Theme definition format (JSON):
  ```json
  {
    "name": "One Dark Pro",
    "type": "dark",
    "ui": { "bg": "#282c34", "accent": "#61afef", "sidebar": "#21252b", ... },
    "terminal": { "background": "#282c34", "foreground": "#abb2bf", "cursor": "#528bff", ... },
    "syntax": { "keyword": "#c678dd", "string": "#98c379", "comment": "#5c6370", ... }
  }
  ```
- Custom theme import: drop a `.maverick-theme.json` file into `~/.maverick/themes/`.
- Theme persisted in `~/.maverick/settings.json`.

### 5.11 Typography

- **UI font:** Geist Mono (bundled, variable weight) for all UI text — navigation, labels, input bars, agent messages.
- **Terminal font:** Geist Mono Nerd Font (bundled) — enables powerline symbols, git glyphs, icon fonts.
- **Font size:** configurable per context (UI: 12px default; terminal: 13px default) in Settings → Appearance.
- **Font ligatures:** enabled by default for UI font, toggle for terminal font.
- Fallback chain: `Geist Mono → SF Mono → Menlo → monospace`.
- Font configurable in `Settings → Appearance → Font`.

### 5.12 Keyboard Shortcuts

Full keyboard-first operation. All shortcuts configurable in `Settings → Keybindings`.

**Workspace & Navigation**

| Shortcut | Action |
|---|---|
| `⌘[` / `⌘]` | Previous / next workspace |
| `⌘1`–`⌘9` | Jump to workspace by index |
| `⌘N` | New workspace |
| `⌘W` | Close active workspace |
| `⌘⇧N` | New project |
| `⌘B` | Toggle sidebar |
| `⌘⇧E` | Focus file tree |
| `⌘L` | Focus input bar |

**Terminal Mode**

| Shortcut | Action |
|---|---|
| `⌘T` | Toggle Agent ↔ Terminal mode |
| `⌘D` | Split terminal horizontally |
| `⌘⇧D` | Split terminal vertically |
| `⌘⌥←/→/↑/↓` | Focus adjacent pane |
| `⌘⇧W` | Close active terminal pane |
| `⌘⇧=` / `⌘-` | Increase / decrease font size |
| `⌘K` | Clear active terminal |
| `⌘⇧[` / `⌘⇧]` | Cycle terminal panes |

**Agent Mode**

| Shortcut | Action |
|---|---|
| `⌘↑` | Scroll to top of conversation |
| `⌘↓` | Scroll to bottom |
| `⌘F` | Search in conversation |
| `⌘⇧C` | Copy last agent response |
| `⌘⇧R` | Retry last prompt |
| `/` | Focus input and open command palette |

**Diff Viewer**

| Shortcut | Action |
|---|---|
| `]c` | Next hunk |
| `[c` | Previous hunk |
| `⌘⇧A` | Stage current hunk |
| `⌘⇧U` | Unstage current hunk |

**Global**

| Shortcut | Action |
|---|---|
| `⌘,` | Open Settings |
| `⌘⇧T` | Theme picker |
| `⌘⇧P` | Command palette |
| `⌘⇧K` | Keyboard shortcut reference |
| `⌘⇧.` | Toggle right panel |
| `⌘Q` | Quit Maverick |

### 5.13 Workspace Presets (Quick Launch)

Saved workspace layout configurations — like iTerm2 window arrangements or tmux session files. Define once, launch instantly.

**What a preset defines:**

| Field | Example |
|---|---|
| Name | "Full stack review" |
| Layout | 2×2 grid, browser left, terminals right |
| Pane count | 1–6 terminal panes + optional browser pane |
| Per-pane agent | terminal 1 → claude-code, terminal 2 → codex, terminal 3 → shell |
| Per-pane working directory | `{{workspace_root}}`, `{{workspace_root}}/frontend`, `/tmp` |
| Per-pane startup command | `claude --continue`, `bun run dev`, `bun test --watch` |
| Per-pane mode | agent mode or terminal mode |
| Browser URL | `http://localhost:3000`, blank |
| Base branch | `origin/main`, `origin/development` |

**Preset format in `maverick.yaml`:**

```yaml
presets:
  - name: full-stack-review
    description: "Claude on backend, Codex on frontend, dev server, browser"
    layout:
      type: split
      direction: h
      ratio: 0.6
      left:
        type: split
        direction: v
        ratio: 0.5
        top:
          type: terminal
          agent: claude-code
          cwd: "{{workspace_root}}"
          startup: "claude --continue"
          mode: agent
        bottom:
          type: terminal
          agent: codex
          cwd: "{{workspace_root}}/frontend"
          startup: "codex"
          mode: agent
      right:
        type: split
        direction: v
        ratio: 0.5
        top:
          type: terminal
          agent: shell
          cwd: "{{workspace_root}}"
          startup: "bun run dev"
          mode: terminal
        bottom:
          type: browser
          url: "http://localhost:3000"

  - name: solo-claude
    description: "Single full-screen Claude Code session"
    layout:
      type: terminal
      agent: claude-code
      cwd: "{{workspace_root}}"
      startup: "claude"
      mode: agent
```

**Quick launch UI:**
- `⌘⇧Space` → opens preset picker (fuzzy searchable list of all presets).
- Each preset shows: name, description, pane layout thumbnail, agent icons.
- Selecting a preset: creates a new worktree on the configured base branch, spawns all PTYs, runs startup commands, opens browser if configured.
- Presets also accessible from: "New Workspace" button → "From Preset" tab.
- Global presets stored in `~/.maverick/presets.yaml`; per-repo presets in `maverick.yaml`.
- **Save current layout as preset:** right-click workspace tab → "Save layout as preset" → names and writes to `maverick.yaml`.

**Template variables available in preset fields:**

| Variable | Resolves to |
|---|---|
| `{{workspace_root}}` | Absolute path to the worktree root |
| `{{project_name}}` | Repo name |
| `{{branch}}` | Active branch name |
| `{{workspace_name}}` | Workspace display name |
| `{{home}}` | User's home directory |

### 5.14 Git Module

Dedicated full-featured git UI accessible from the sidebar — not just change indicators embedded in the file tree.

- **Branch management:** create, checkout, rename, delete branches; visualise branch graph.
- **Commit log:** `git log` as scrollable list with author, message, SHA, timestamp, file count.
- **Stage / unstage / commit:** interactive staging area; multi-line commit message editor.
- **Stash management:** stash, pop, apply, drop with names.
- **Remote operations:** fetch, pull, push, set upstream — with conflict detection.
- **Cherry-pick & rebase:** via UI — no CLI knowledge required.
- **Blame view:** per-file git blame with line-level commit metadata tooltip.
- **Merge conflict resolver:** side-by-side conflict view with Accept Ours / Accept Theirs / Accept Both buttons per hunk.
- Keyboard shortcut: `⌘⇧G` to open Git module.

### 5.15 Web Browser Panel

Embedded full browser panel accessible from the sidebar (browser icon) or `⌘⇧B`.

- **URL bar** with back / forward / refresh / stop controls.
- **Element inspector / AI pointer:** hover over any page element → click → element's outer HTML + computed text extracted and inserted into the active workspace's input bar as context. Enables prompting the AI with "fix this component" by pointing at it visually.
- **WYSIWYG mode:** `⌘⇧I` toggle — renders a semi-transparent overlay; clicking an element captures its selector, text, and HTML and appends it to the input bar.
- Implementation: Tauri's `WebviewWindow` with message passing between the webview and the main UI. Uses `MutationObserver` + injected content script to report selected element metadata.
- Supports custom URLs (internal dev servers, localhost, production).

### 5.16 Kanban Board

Task tracking panel for the active project, accessible from the sidebar or `⌘⇧K`.

- Default columns: **Backlog → In Progress → Review → Done**.
- Tasks stored in SQLite (`kanban_tasks` table) per project.
- Each task: title, description (markdown), status, assignee (agent backend), linked workspace, labels, due date.
- Drag-and-drop between columns (keyboard accessible: move with `M` then arrow keys).
- **Agent integration:** clicking "Start in Maverick" on a task creates a new workspace pre-seeded with the task description as the initial prompt.
- Import from: GitHub Issues (via `gh` CLI), Linear, plain text list.
- Export: markdown checklist or GitHub Issues.

### 5.17 Automations

Saved multi-step operation sequences. Accessible from the sidebar Automations section or `⌘⇧A`.

- Each automation: `name`, `trigger` (manual / schedule / on-file-change), list of `steps`.
- Step types: run skill, run shell command, create workspace, git commit/push, send notification, open URL.
- Visual step builder (no-code) + raw YAML edit mode.
- Stored per-project in `maverick.yaml` under `automations:` key, or globally in `~/.maverick/automations.yaml`.
- Example automations:
  - "Daily PR review" — run `review` skill on current diff + open PR URL
  - "Deploy staging" — run `bun run build` → `git push` → open preview URL
  - "Test + commit" — run tests, if passing commit + push

```yaml
automations:
  - name: deploy-staging
    trigger: manual
    steps:
      - type: shell
        command: bun run build
      - type: skill
        skill: review
      - type: git
        action: push
        remote: origin
        branch: staging
```

### 5.18 Notifications

System-level and in-app notifications for async agent events.

- **Agent waiting for input:** native OS notification + in-app badge on workspace tab. Agent process pauses at stdin; notification includes workspace name and last agent message excerpt.
- **Agent task complete:** notification with summary (files changed, tests passed/failed).
- **Agent error / crash:** red badge + notification with error message.
- **Build / test result:** pass (green) / fail (red) notification when run script completes.
- **Quota warning:** notification at 80% and 100% of quota for each backend.
- In-app notification bell (top right) with history. Click → jump to relevant workspace.
- macOS: uses native `NSUserNotification` / `UNUserNotificationCenter` via Tauri plugin.
- Windows/Linux: uses OS native notification API via Tauri.
- Notification preferences configurable per event type in `Settings → Notifications`.

### 5.19 Context & Quota Tracker

Token and cost awareness per workspace and globally.

- **Context usage bar:** shown in the input bar area. Displays tokens used / context window for the active backend (e.g. `42k / 200k`). Color: green → amber → red as usage increases.
- **Session cost estimate:** running estimate per session based on model pricing (configurable in Settings → Models).
- **Quota tracker:** for backends with rate limits (Codex, Gemini), tracks requests/minute and requests/day against configured limits. Shows remaining quota in the backend status footer.
- Data stored per session in SQLite. Aggregated view in `Settings → Usage`.
- Context window sizes configurable per model in `Settings → Models`.

### 5.20 Caffeinate

Prevents system sleep while any AI agent is actively running.

- macOS: spawns `caffeinate -i` as a managed child process; killed when all agents idle.
- Windows: calls `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` via Rust FFI.
- Linux: calls `systemd-inhibit` or `xdg-screensaver reset` polling loop.
- Status shown in the backend footer: ☕ icon when caffeinate is active.
- Toggle: `Settings → Advanced → Caffeinate while agents running` (on by default).

### 5.21 MCP Servers

Model Context Protocol server management — surfaces additional tools to AI backends that support MCP (Claude Code, custom).

- **MCPs section** in sidebar: list of configured MCP servers with status dots (running / stopped / error).
- **Add MCP:** name + command + args + env vars. Maverick spawns and manages the MCP server process lifecycle.
- **Per-workspace MCP toggle:** enable/disable specific MCP servers per workspace via `maverick.yaml` `mcps:` key.
- MCP server logs viewable via click → opens in a terminal pane.
- Common MCPs bundled as presets: filesystem, git, sqlite, fetch, puppeteer.

```yaml
mcps:
  - name: filesystem
    command: npx
    args: [-y, "@modelcontextprotocol/server-filesystem", "/path/to/workspace"]
  - name: fetch
    command: npx
    args: [-y, "@modelcontextprotocol/server-fetch"]
```

### 5.22 Maverick Instruction File

A `MAVERICK.md` file (or `.maverick/MAVERICK.md`) at repo root that is automatically prepended to every prompt sent to AI backends — equivalent to `CLAUDE.md` for Claude Code or `AGENTS.md` for Codex.

- Maverick reads `MAVERICK.md` on workspace creation and injects its contents as a system context prefix.
- Falls back to `CLAUDE.md` → `AGENTS.md` → none, in priority order (configurable in Settings).
- Also supports `~/.maverick/GLOBAL.md` for cross-repo instructions.
- Editable inline from `Settings → Repositories → [repo] → Instructions`.
- Character count shown; warns if > 4000 tokens (may consume context budget).

### 5.23 File Previewers

Inline file preview panel accessible from the file tree (click → preview) or `⌘P` quick-open.

- **Markdown:** rendered with `react-markdown` + `remark-gfm`. Supports tables, task lists, fenced code blocks with syntax highlighting (`highlight.js`). Toggle raw / preview with `⌘⇧M`.
- **PDF:** rendered via `pdfjs-dist` (Mozilla PDF.js). Page navigation, zoom, text selection, search. No external process needed.
- **Images:** PNG, JPEG, GIF, WebP, SVG inline preview with zoom (scroll to zoom), pan, and copy-to-clipboard.
- **Video:** MP4/WebM basic preview player.
- **Other files:** hex dump or raw text fallback.
- Preview opens in a sliding panel over the right panel, or in a dedicated center panel tab (`⌘⇧V`).

### 5.24 Auto-convert Long Text

Prevents context window bloat from accidental large pastes.

- When pasted text in the input bar exceeds **5,000 characters**, Maverick automatically:
  1. Extracts the text into a temporary `.txt` attachment file in the workspace.
  2. Replaces the inline text with an `@attachment:filename.txt` reference in the input bar.
  3. Shows a toast: "Large text converted to attachment (12,340 chars → context.txt)".
- Attachments are stored in `.maverick/attachments/` in the worktree, auto-cleaned after session.
- User can revert: click the attachment chip → "Inline text" to paste back.
- Threshold configurable in `Settings → Advanced → Large text threshold`.

### 5.25 Settings UI

Full settings panel, opened via `⌘,` or sidebar gear icon. Modelled on Conductor's settings structure.

**Sections:**

| Section | Contents |
|---|---|
| General | Default backend, default branch, workspace naming, startup behaviour |
| Models | Context window sizes, cost-per-token estimates, default model per backend |
| Providers | API key storage hints, backend health check, version detection |
| Environment | Global env vars injected into all workspace PTYs |
| Appearance | Theme picker, font size (UI + terminal), ligatures, sidebar width, animations on/off |
| Notifications | Per-event toggle (waiting, complete, error, quota warning) |
| Keybindings | Full shortcut table, rebindable, import/export JSON |
| Git | Default remote, commit message template, auto-fetch interval, GPG signing |
| MCPs | Global MCP server list, autostart toggles |
| Advanced | Large text threshold, LRU workspace limit, caffeinate toggle, telemetry opt-out |
| Account | License key, plan info, update channel (stable / beta) |
| Terminal | New tab preset commands (Claude, Codex, Gemini, Amp, Copilot, OpenCode, None + custom) |
| Repositories | Per-repo config (see §5.25) |

### 5.26 Repository Config

Per-repo settings panel within Settings → Repositories. Modelled on Conductor's repo settings.

- **Root path:** absolute path to the repo (read-only, set at add-project time).
- **Workspaces path:** where `git worktree` checkouts are stored (default: `{repo}/.maverick/worktrees/`).
- **Branch new workspaces from:** default base branch (e.g. `origin/main`).
- **Remote origin:** which remote to use for push/pull/PR creation.
- **Preview URL:** override for the "Open" button in the Run tab. Supports env vars (`$MAVERICK_PORT`, `$MAVERICK_WORKSPACE_NAME`).
- **Files to copy:** list of file paths copied into each new worktree on creation (e.g. `.env`).
- **Scripts:**
  - *Setup script:* runs on new workspace creation (e.g. `bun install`)
  - *Run script:* runs when user clicks ▶ Play (e.g. `bun run dev`)
  - *Archive script:* runs before workspace is archived/deleted
- **AI Preferences** (per-repo instruction overrides):
  - Code review preferences
  - Create PR preferences
  - Fix errors preferences
  - Resolve conflicts preferences
  - Branch name style
  - General instructions (prepended to all prompts for this repo)

### 5.27 AI PR Review

Built-in PR review workflow accessible via the Git module or `⌘⇧R`.

- Fetches the full diff between current branch and base branch.
- Sends diff through the active backend with a configurable review prompt (set in `Settings → Repositories → [repo] → Code review preferences`).
- Review output streamed into the Agent view as a structured response: summary, per-file findings, severity ratings.
- One-click "Create PR" after review: calls `gh pr create` with AI-generated title + body.
- Create PR preferences (style, template) configurable per repo.

### 5.28 Distribution

- `getmaverick.sh` curl installer: detects platform (macOS/Linux/Windows), downloads binary + Bun sidecar.
  - macOS: installs to `/usr/local/bin/maverick`, optional `.dmg`
  - Linux: installs to `/usr/local/bin/maverick`, optional `.AppImage` / `.deb`
  - Windows: `.msi` installer, installs to `%LOCALAPPDATA%\Maverick`
- Auto-update check on launch (GitHub releases API, diff-based patch updates).
- Universal macOS binary (arm64 + x86_64).

---

## 6. UI / UX Requirements

- **Theme system:** 12 bundled themes (see 5.10), custom theme import, persisted in `~/.maverick/settings.json`. Default: Maverick Dark.
- **Glassmorphism throughout:** backdrop-blur + translucent backgrounds applied to sidebar, panels, modals, tooltips, tab bars, input bars, and popovers — not just overlays. Blur radius: 12–24px. Background alpha: 0.6–0.85. `saturate(180%)` filter on all glass layers.
- **Native OS window chrome:** macOS traffic lights + draggable titlebar; Windows/Linux custom titlebar with min/max/close buttons styled to match the active theme.
- **Typography:** Geist Mono bundled as primary font for UI + terminal. Geist Mono Nerd Font for terminal icons/glyphs. Font size and ligatures configurable per context.
- **Responsive within window:** sidebar collapsible (icon-only mode at < 900px window width). Right panel collapsible via `⌘⇧.`.
- **Animations:** subtle spring transitions on panel open/close (Framer Motion), fade-in for messages, smooth workspace switching — no layout shift.
- **Keyboard-first:** every feature reachable without a mouse. Full shortcut reference at `⌘⇧K`.
- **Minimum window size:** 800 × 600px.

---

## 7. Performance Requirements

| Scenario | Target |
|---|---|
| `Cmd+[/]` workspace switch | < 10ms |
| First workspace open (cold PTY) | ≤ 150ms |
| App launch to usable UI | ≤ 2s |
| Terminal input → screen render | ≤ 16ms (60fps) |
| SQLite query (messages fetch) | < 5ms |

---

## 8. Security Requirements

- No API keys stored by Maverick — credentials live in each CLI tool's own config.
- `maverick.yaml` must not contain secrets (documented in README, validated by config loader).
- Subprocess spawning sandboxed via Tauri's `shell` scope — allowlist of approved commands.
- SQLite DB stored in OS user data dir:
  - macOS: `~/Library/Application Support/maverick/db.sqlite`
  - Linux: `~/.local/share/maverick/db.sqlite`
  - Windows: `%APPDATA%\maverick\db.sqlite`
- Theme files validated against JSON schema before import — no code execution from theme files.

---

## 9. Monetisation (Post v0.1)

| Plan | Price | Limits |
|---|---|---|
| Free | $0 | 3 backends, 10 skills |
| Pro | $12/mo | Unlimited backends, all skills, priority support |
| Team | $8/seat/mo | Pro features + team `maverick.yaml` sync |
| Enterprise | Custom | SSO, audit logs, custom backends |

---

## 10. Roadmap

| Version | Target | Key Features |
|---|---|---|
| v0.1 | Q2 2026 | Core scaffold: CLI dispatcher + 6-pane terminal + projects + diff viewer + YAML skills + themes + shortcuts + cross-platform + git module + browser panel + kanban + automations + notifications + context tracker + caffeinate + MCPs + MAVERICK.md + file previewers + settings UI + repo config + AI PR review |
| v0.2 | Q3 2026 | Ghostty `TerminalProvider` implementation, AI micro-features (autocomplete, title naming, prompt enhancer via Ollama), plugin SDK |
| v0.3 | Q4 2026 | Community theme/skill marketplace, custom font import, team collaboration |
| v1.0 | Q4 2026 | Auth, billing, team `maverick.yaml` sync, cloud backup, SSO |
