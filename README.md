![Maverick](./public/maverick-logo.svg)# Maverick

**A native desktop IDE for orchestrating AI coding agents** \
Run Claude Code, Codex, Gemini, Aider, Ollama, and any CLI agent side by side\
in a single workspace — each isolated in its own git worktree.

[Features](#-features) • [Quick Start](#-quick-start) • [Architecture](#-architecture) • [Configuration](#-configuration) • [Project Layout](#-project-layout) • [Development](#-development)

![Tauri v2](https://img.shields.io/badge/Tauri-v2-blueviolet)![React 19](https://img.shields.io/badge/React-19-61DAFB)![Bun 1.3+](https://img.shields.io/badge/Bun-%5E1.3-black)![Rust stable](https://img.shields.io/badge/Rust-stable-orange)![MIT License](https://img.shields.io/badge/license-MIT-blue)---

**Maverick is the OS layer above every AI coding CLI.**\
Stop juggling terminal tabs. Stop losing context when you switch agents. Start running multiple AI agents in parallel — each in its own isolated workspace — without them stepping on each other.

Bare metal. Keyboard-first. Locally owned.

---

## ✦ Features

### AI Agent Orchestration

|  |  |
| --- | --- |
| **Multi-agent** | Run Claude Code, Codex, Gemini CLI, Aider, Ollama, or any custom CLI in parallel — up to 6 agent workspaces visible in a single window |
| **Workspace isolation** | Every agent run gets its own `git worktree` — isolated working copy, isolated branch, no cross-contamination |
| **Agent ↔ Terminal mode** | Toggle between the agent's conversation interface and a live PTY grid with `⌘T` — both stay alive across switches |
| **Instruction injection** | First prompt of every session is automatically prefixed with your project's `MAVERICK.md` (falls back to `CLAUDE.md` → `AGENTS.md`) plus a global `~/.maverick/MAVERICK.md` |

### VSCode-Style Workbench

|  |  |
| --- | --- |
| **Full shortcut coverage** | Every action reachable without a mouse — Command Palette (`⌘⇧P`), Quick Open (`⌘P`), workspace jumps (`⌘1`–`⌘9`), and 60+ configurable bindings |
| **ActivityBar + PrimarySideBar** | Projects, Kanban, Automations, MCPs — icon-driven navigation with keyboard shortcuts |
| **EditorArea** | Keep-alive mounted editor groups — workspace switches at &lt;10ms, PTYs survive tab changes, LRU suspension beyond 20 open workspaces |
| **AuxiliaryBar** | File tree with M/A/D/R indicators, syntax-highlighted diff viewer with hunk-level stage/unstage |
| **Panel** | Setup scripts, run output, and a raw PTY shell — all scoped to the active worktree |
| **StatusBar** | Branch, sync state, token usage, caffeine indicator, backend status, notifications |

### Git & PR Workflow

- **Full git module** (`⌘⇧G`): branch management, commit log, staging area, stash, blame, conflict resolver, cherry-pick
- **AI Code Review** (`⌘⇧R`): diffs the active workspace, builds a context-aware prompt, and pipes it to your agent
- **One-click PR creation**: pushes the branch and runs `gh pr create --fill` — PR URL returned in-app

### Skills Engine

YAML-defined reusable prompt templates. Define once, invoke from anywhere:

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

Template variables: `{{file}}`, `{{selection}}`, `{{branch}}`, `{{project}}`, `{{diff}}`.

### Built-In Tools

| Tool | Access | Description |
| --- | --- | --- |
| **Kanban** | `⌘⇧K` | Per-project task board (Backlog → In Progress → Review → Done). Drag-and-drop, markdown descriptions, agent-linked workspaces |
| **Browser** | `⌘⇧B` | Embedded webview with element inspector — click an element to capture its HTML and inject it into the active agent's context |
| **Git** | `⌘⇧G` | Full git UI: log, stage/commit, stash, blame, conflict resolver, cherry-pick |
| **Automations** | `⌘⇧A` | Saved multi-step sequences — shell commands, skill runs, git operations, URL opens |
| **MCP Servers** | Sidebar | Lifecycle-managed Model Context Protocol servers (filesystem, fetch, custom) |
| **File Previewers** | Click to preview | Markdown (rendered), PDF (pdfjs), images, video, raw/hex |
| **Workspace Presets** | `⌘⇧Space` | Saved layout configurations — define once, launch instantly with all PTYs and agents |

### Terminal

- **xterm.js canvas renderer** via pluggable `TerminalProvider` abstraction
- **Binary SplitNode tree** — `⌘D` horizontal split, `⌘⇧D` vertical split, up to 6 panes per workspace
- **Keep-alive mount**: switch away, come back — everything is exactly where you left it
- **Ghostty provider stub** ready for v0.2
- Integrated PTY shell in the bottom Panel scoped to the worktree

### Theming & Typography

- **14 bundled themes**: Maverick Dark/Light, One Dark Pro, Dracula, Nord, Catppuccin Mocha/Latte, Tokyo Night, Monokai Pro, GitHub Dark/Light, Solarized Dark, Gruvbox Dark
- **Geist Mono** — bundled variable-weight UI font + Nerd Font for terminal glyphs
- Theme picker in Settings; CSS custom properties drive the entire UI

### Infrastructure

|  |  |
| --- | --- |
| **No API keys** | Maverick never sees your credentials — every CLI uses its own config (`~/.claude.json`, `~/.config/codex`, …) |
| **Zero inference cost** | Maverick never calls AI APIs. It spawns CLI subprocesses. Your subscriptions stay yours |
| **All data local** | SQLite database at `~/Library/Application Support/maverick/` — no cloud dependency |
| **Context & quota tracking** | Per-session token usage, cost estimates, and backend quota monitoring |
| **Caffeinate** | Prevents system sleep while agents are running (macOS, Linux, Windows) |
| **OS notifications** | Agent waiting, task complete, errors, quota warnings — native + in-app |
| **Auto-convert long text** | Pastes &gt;5,000 chars are detached to file attachments, saving context window budget |

---

## ✦ Quick Start

**Prerequisites:**

- [**Bun**](https://bun.sh) ≥ 1.3 — the package manager and sidecar runtime. Do not use npm/yarn/pnpm.
- **Rust** (stable) + Tauri v2 prerequisites — see [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)
- At least one AI CLI on your `PATH` (e.g. `claude`, `codex`, `gemini`), already authenticated
- `git`, and `gh` (GitHub CLI) for the Create-PR flow

```bash
git clone https://github.com/Justmalhar/maverick
cd maverick
bun install                     # install JS dependencies
bun run tauri dev               # launch the app
```

`bun run tauri dev` builds the Rust shell, starts the Vite dev server for the webview, and spawns the Bun sidecar. The first Rust compile takes a minute; subsequent builds are fast.

**To produce a distributable bundle:**

```bash
bun run tauri:build
```

**One-liner installer** (for end users — macOS / Linux / Windows):

```bash
curl -fsSL https://getmaverick.sh | bash
```

---

## ✦ Architecture

```plaintext
┌────────────────────────────────────────────────────────────┐
│                    Maverick.app                            │
│  ┌──────────────────────┐  ┌──────────────────────────┐   │
│  │  WebView (React 19)  │  │  Rust Core (Tauri v2)    │   │
│  │                      │◄─┤  - Window management     │   │
│  │  - Workbench shell   │  │  - JSON-RPC pass-through │   │
│  │  - xterm.js terminals│  │  - PTY manager (pty-fork)│   │
│  │  - SplitNode tree    │  │  - Event forwarding      │   │
│  │  - Panels & tools    │  └───────────┬──────────────┘   │
│  └──────────────────────┘              │ stdio JSON-RPC   │
│                                        ▼                  │
│                         ┌──────────────────────────┐      │
│                         │  Bun Sidecar             │      │
│                         │  (TypeScript process)    │      │
│                         │                          │      │
│                         │  - ProcessManager        │      │
│                         │  - WorktreeManager       │      │
│                         │  - SQLiteStore           │      │
│                         │  - ConfigLoader          │      │
│                         │  - SkillsEngine          │      │
│                         │  - MCPManager            │      │
│                         │  - AutomationRunner      │      │
│                         └───────────┬──────────────┘      │
│                                     │ Bun.spawn()         │
│           ┌─────────────────────────┼────────────────┐    │
│           ▼            ▼            ▼         ▼      │    │
│      claude-code    codex        gemini    aider     │    │
│      (subprocess) (subprocess) (subprocess) (subproc)│    │
└────────────────────────────────────────────────────────────┘
```

**Layered communication:**

```plaintext
React (src/) ──Tauri invoke──▶ Rust (src-tauri/) ──JSON-RPC/stdio──▶ Bun sidecar (sidecar/)
                                                                       └─ PTYs, git worktrees, SQLite, config, MCP
```

- **React** never touches the sidecar directly — it calls Tauri commands
- **Rust** is a dumb JSON-RPC pass-through — it never parses YAML, touches SQLite, or spawns CLIs
- **Bun sidecar** owns all business logic: PTY subprocesses, git worktrees, SQLite persistence, config parsing, skill interpolation, MCP lifecycle
- Cross-layer types are mirrored in `src/lib/ipc.ts` (React) and `sidecar/types.ts` (Bun) — when one changes, the other must change

---

## ✦ Configuration

### Per-Repo

| File | Purpose |
| --- | --- |
| `maverick.json` | Scripts (setup/dev/test), workspace path, base branch, preview URL, AI preferences |
| `maverick.yaml` | Backend definitions, skills presets, automations, MCP servers, workspace presets |
| `MAVERICK.md` | Project instructions automatically prepended to every prompt (falls back to `CLAUDE.md` → `AGENTS.md`) |

### Global

```plaintext
~/.maverick/
├── settings.json      # UI preferences, theme, keybindings
├── MAVERICK.md        # Cross-repo instructions (prepended before project instructions)
├── themes/            # Custom .maverick-theme.json imports
└── presets.yaml       # Global workspace preset definitions
```

### Supported Backends

- `claude-code` — Anthropic's Claude Code CLI
- `codex` — OpenAI Codex CLI
- `gemini` — Google Gemini CLI
- `aider` — Aider AI pair programming
- `ollama` — Local LLMs via Ollama
- `custom` — Any CLI that reads stdin / writes stdout

---

## ✦ Project Layout

```plaintext
src/                   React 19 webview
  components/          Workbench shell, editor, UI primitives
  panels/              Git, Kanban, Browser, automations, MCPs, settings
  hooks/               useWorkspace, usePty, useShortcuts, useSkills
  lib/                 IPC types, terminal providers, stores
  state/               Zustand store (useWorkbench)
  styles/              Tailwind v4 tokens, themes, fonts
  shortcuts/           Keyboard shortcut registry
  themes/              Theme provider + definitions
  test/                Test setup (MSW, mocks)
  assets/              Icons, images

src-tauri/             Rust Tauri v2 core
  src/commands/        IPC command pass-through (one module per group)
  src/remote/          Remote server (companion protocol)

sidecar/               Bun sidecar (TypeScript)
  index.ts             JSON-RPC server entry
  rpc-handlers.ts      Method dispatch (Zod-validated)
  process-manager.ts   PTY subprocess lifecycle
  worktree-manager.ts  git worktree operations
  sqlite-store.ts      bun:sqlite persistence
  config-loader.ts     maverick.yaml + maverick.json parser
  skills-engine.ts     Prompt template interpolation
  git-module.ts        Full git operations
  mcp-manager.ts       MCP server lifecycle
  migrations/          SQLite schema migrations

scripts/               Build helpers
e2e/                   Playwright E2E tests
.github/               GitHub Actions CI + nightly E2E
```

---

## ✦ Development

### Commands

| Command | What it does |
| --- | --- |
| `bun run dev` | Start Vite dev server |
| `bun run tauri dev` | Full dev launch (Rust + Vite + sidecar) |
| `bun run build` | TypeScript check + Vite build |
| `bun run tauri:build` | Build sidecar + `tauri build` for distribution |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run test:coverage` | Vitest with coverage (thresholds: 100% lines, 95% branches, 100% functions, 100% statements) |
| `bun run test:sidecar` | `bun test` in sidecar/ |
| `bun run test:rust` | `cargo test` in src-tauri/ |
| `bun run test:all` | All three test suites in order |
| `bun run test:e2e` | Playwright E2E golden path |

### Coverage Thresholds

Coverage is CI-enforced at **100% lines / 95% branches / 100% functions / 100% statements**. Every public function ships with a test.

### Architecture Constraints

- **bun, not npm.** Always `bun install`, `bun run`, `bunx`.
- **TerminalView never imports xterm.js directly** — go through `TerminalRegistry.get()`. Adding a new renderer requires zero changes outside `src/lib/providers/`.
- **Keep-alive mount for editor groups** — inactive groups go `display:none`, never unmount. PTYs must survive tab switches.
- **No API keys in Maverick** — every backend reads credentials from its own CLI config.
- **VSCode terminology** — ActivityBar, PrimarySideBar, EditorArea, EditorGroup, AuxiliaryBar, Panel, StatusBar, etc. Never use non-canonical names.
- **shadcn primitives + Tailwind v4 utility classes only** — no hand-rolled CSS values. Design tokens live in `src/styles/tokens.css`.

---

## ✦ License

[MIT](./LICENSE) © Malhar Ujawane

---

Built with Tauri v2 · React 19 · Bun · Rust · and the conviction that AI agents belong in a dedicated workspace, not a terminal tab you found somewhere.