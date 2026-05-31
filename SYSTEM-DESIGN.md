# Maverick — System Design

**Version:** 0.1  
**Author:** Malhar Ujawane  
**Last Updated:** 2026-05-20

---

## 1. Functional Requirements

- Spawn and manage AI CLI subprocesses (Claude Code, Codex, Gemini, Aider, Ollama, custom)
- Multiplex up to 6 live PTY sessions in a single window (tmux-style binary split tree)
- Persist conversation history, project state, and workspace metadata in local SQLite
- Isolate each agent run in its own `git worktree`
- Toggle between Agent mode (chat UI) and Terminal mode (PTY grid) per workspace
- Read per-repo `maverick.yaml` to configure backends, worktree paths, skills, and scripts
- Keep PTYs alive across workspace tab switches (< 10ms switch latency)
- Render inline git diffs with hunk-level stage/unstage (diff viewer)
- Execute YAML-defined skill templates from the input bar (`/skill-name`)
- Apply and persist UI + terminal themes from a bundled theme library (12 themes)
- Handle a complete keyboard shortcut system — all actions reachable without a mouse
- Run on macOS (arm64/x86_64), Windows (x64), and Linux (x64/arm64) from a single codebase
- Embedded browser panel with element inspector → AI context capture
- Kanban board per project (tasks stored in SQLite)
- Automations: saved multi-step sequences with manual/scheduled/file-change triggers
- Git module: full log, stage/commit, stash, blame, conflict resolution, cherry-pick
- OS native notifications for agent-waiting, completion, errors, quota warnings
- Context usage and quota tracking per workspace and globally
- Caffeinate: prevent system sleep while agents are active (cross-platform)
- MCP server lifecycle management (spawn, monitor, restart)
- MAVERICK.md instruction file auto-prepended to all prompts
- Inline file previewers: Markdown, PDF, image, video
- Auto-convert pasted text > 5,000 chars to file attachments
- Full settings UI with per-section configuration
- Per-repo config (paths, scripts, AI preferences)

## 2. Non-Functional Requirements

| Attribute | Requirement |
|---|---|
| Performance | `Cmd+[/]` switch < 10ms; first PTY open ≤ 150ms; terminal render ≤ 16ms |
| Binary size | ≤ 15MB installed (Tauri v2 + bundled fonts) |
| Platform | macOS (arm64 + x86_64), Windows (x64), Linux (x64 + arm64) |
| Data locality | All data stored locally — no cloud dependency in v0.1 |
| Security | No API keys in Maverick; CLI credentials managed by each tool |
| Reliability | PTY process survives workspace tab switch, window resize, and app backgrounding |

---

## 3. High-Level Design (HLD)

### 3.1 Component Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        macOS Host                                │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Maverick.app  (Tauri v2)                               │    │
│  │                                                         │    │
│  │  ┌─────────────────────┐   ┌─────────────────────────┐ │    │
│  │  │  WebView (React UI) │   │  Rust Core              │ │    │
│  │  │                     │◄──┤  - Window management    │ │    │
│  │  │  - WorkspaceContext  │   │  - IPC bridge           │ │    │
│  │  │  - xterm.js (PTY)   │   │  - File system access   │ │    │
│  │  │  - SplitNode tree   │   │  - Tauri commands       │ │    │
│  │  │  - Sidebar/panels   │   └──────────┬──────────────┘ │    │
│  │  └─────────────────────┘              │ sidecar IPC    │    │
│  │                                       ▼                │    │
│  │                          ┌────────────────────────┐    │    │
│  │                          │  Bun Sidecar           │    │    │
│  │                          │  (TypeScript process)  │    │    │
│  │                          │                        │    │    │
│  │                          │  - ProcessManager      │    │    │
│  │                          │  - WorktreeManager     │    │    │
│  │                          │  - SQLiteStore         │    │    │
│  │                          │  - ConfigLoader        │    │    │
│  │                          └──────────┬─────────────┘    │    │
│  └─────────────────────────────────────┼──────────────────┘    │
│                                        │ Bun.spawn()           │
│              ┌─────────────────────────┼──────────────────┐    │
│              ▼             ▼           ▼          ▼        │    │
│         claude-code     codex       gemini      aider      │    │
│         (subprocess)  (subprocess) (subprocess) (subprocess│    │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow — Sending a Prompt

```
User types prompt → React input component
  → WorkspaceContext.sendPrompt(workspaceId, text)
  → Tauri invoke('send_prompt', { workspaceId, text })
  → Rust handler → JSON-RPC to Bun sidecar
  → ProcessManager.write(workspaceId, text + '\n')
  → Bun.stdin.write() → CLI subprocess stdin
  → CLI subprocess processes → writes to stdout
  → Bun reads stdout → emits 'pty_data' event via Tauri
  → React: xterm.js.write(data) → rendered in terminal
  → Concurrently: SQLiteStore.appendMessage(sessionId, data)
```

### 3.3 Data Flow — Workspace Switch

```
User presses Cmd+]
  → React: WorkspaceContext.setActiveWorkspace(nextId)
  → CSS: current panel display:none, next panel display:flex
  → xterm.js: terminal.focus() on active pane
  → No IPC, no PTY restart — pure React state change
  → Target: < 10ms
```

---

## 4. Low-Level Design (LLD)

### 4.1 React Component Tree

```
App
├── TitleBar
│   ├── TrafficLights
│   ├── BreadcrumbNav (project › branch)
│   └── WorkspaceBadges (active workspace pills)
├── AppBody
│   ├── Sidebar (220px fixed)
│   │   ├── SidebarNav (Dashboard, History)
│   │   ├── ProjectList
│   │   │   └── ProjectItem[]
│   │   │       └── WorkspaceItem[] (branch, agent, status dot)
│   │   └── BackendStatusFooter
│   ├── CenterPanel (flex)
│   │   ├── WorkspaceTabBar
│   │   │   └── WorkspaceTab[] + AddTab button
│   │   └── WorkspacePanelContainer (keep-alive mount)
│   │       └── WorkspacePanel[] (display:none when inactive)
│   │           ├── AgentView (shown when mode === 'agent')
│   │           │   ├── MessageList
│   │           │   │   ├── ToolCallSummary (collapsible)
│   │           │   │   ├── UserMessage
│   │           │   │   └── AgentResponse (markdown, diffs, file badges)
│   │           │   └── InputBar (prompt, model selector, send)
│   │           └── TerminalView (shown when mode === 'terminal')
│   │               └── SplitPane (recursive SplitNode tree)
│   │                   └── TerminalPane (xterm.js instance)
│   └── RightPanel (260px fixed)
│       ├── FileTreePanel
│       │   ├── PanelTabs (All files | Changes | Checks)
│       │   └── FileTree (recursive, M/A/D indicators)
│       └── TerminalSubPanel
│           ├── SubPanelTabs (Setup | Run | Terminal)
│           └── TerminalInstance (xterm.js)
├── ThemeProvider (CSS custom properties injection from active theme)
├── KeyboardShortcutHandler (global hotkey registry, `tinykeys`)
├── NotificationManager (OS notifications + in-app bell)
├── CaffeinateManager (cross-platform sleep inhibition)
└── WorkspaceContext (React context — source of truth)

Additional top-level panels (toggled from sidebar icons):
├── GitPanel (⌘⇧G) — log, stage/commit, stash, blame, conflict resolver
├── BrowserPanel (⌘⇧B) — embedded WebviewWindow, URL bar, element inspector
├── KanbanBoard (⌘⇧K) — per-project task board
├── AutomationsPanel (⌘⇧A) — saved step sequences
├── MCPsPanel — MCP server list + lifecycle controls
├── FilePreviewPanel — Markdown/PDF/Image/Video inline viewer
└── SettingsPanel (⌘,) — full settings UI
```

### 4.2 WorkspaceContext State Shape

```typescript
interface WorkspaceState {
  projects: Project[]
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  terminalMode: Record<string, 'agent' | 'terminal'>  // per workspace
  splitTrees: Record<string, SplitNode>                // per workspace
  backends: Backend[]
  theme: ThemeDefinition
  keybindings: KeybindingMap
  skills: Skill[]                                      // loaded from maverick.yaml
}

interface ThemeDefinition {
  name: string
  type: 'dark' | 'light'
  ui: Record<string, string>       // CSS custom property values
  terminal: TerminalTheme          // passed to TerminalProvider.setTheme() — renderer-agnostic
  syntax: Record<string, string>
}

interface Skill {
  name: string
  description: string
  prompt: string
  backend?: string
}

interface WorkspacePreset {
  name: string
  description?: string
  baseBranch?: string
  layout: PresetNode
}

type PresetNode =
  | { type: 'terminal'; agent: string; cwd: string; startup?: string; mode: 'agent' | 'terminal' }
  | { type: 'browser'; url?: string }
  | { type: 'split'; direction: 'h' | 'v'; ratio: number; top: PresetNode; bottom: PresetNode }
  | { type: 'split'; direction: 'h' | 'v'; ratio: number; left: PresetNode; right: PresetNode }

interface Automation {
  name: string
  trigger: 'manual' | 'schedule' | 'on-file-change'
  steps: AutomationStep[]
}

interface MCPServer {
  name: string
  command: string
  args: string[]
  status: 'running' | 'stopped' | 'error'
  pid?: number
}

interface NotificationPrefs {
  agentWaiting: boolean
  agentComplete: boolean
  agentError: boolean
  quotaWarning: boolean
}

interface ContextUsage {
  workspaceId: string
  tokensUsed: number
  contextWindow: number
  sessionCostEstimate: number   // USD
}

interface Workspace {
  id: string
  projectId: string
  branch: string
  agentBackend: string
  worktreePath: string
  status: 'active' | 'idle' | 'error'
  sessionId: string
}

type SplitNode =
  | { type: 'terminal'; id: string; backend: string; ptyId: string }
  | { type: 'split'; direction: 'h' | 'v'; ratio: number; left: SplitNode; right: SplitNode }
```

### 4.3 Bun Sidecar Modules

```
src-sidecar/
├── index.ts              # JSON-RPC server entry point
├── process-manager.ts    # Bun.spawn() lifecycle, PTY I/O
├── worktree-manager.ts   # git worktree add/remove/list
├── sqlite-store.ts       # bun:sqlite queries (projects, workspaces, messages)
├── config-loader.ts      # maverick.yaml + maverick.json parser + Zod validation
├── skills-engine.ts      # skill template resolution + variable interpolation
├── diff-reader.ts        # git diff --unified output parser + hunk stage/unstage
├── git-module.ts         # git log, stash, cherry-pick, blame, conflict resolution
├── preset-launcher.ts    # PresetNode tree → worktree + PTY spawn sequence
├── kanban-store.ts       # kanban_tasks CRUD
├── automation-runner.ts  # step execution engine for automations
├── mcp-manager.ts        # MCP server spawn + health check
├── notification-service.ts  # OS notification dispatch via Tauri
├── caffeinate.ts         # cross-platform sleep inhibition
├── context-tracker.ts    # token counting, quota tracking per session
├── attachment-store.ts   # large text → file attachment conversion
└── types.ts              # Shared TypeScript interfaces
```

**JSON-RPC methods exposed to Rust:**

| Method | Params | Returns |
|---|---|---|
| `workspace.create` | `{ projectId, branch, backend }` | `{ workspaceId, worktreePath }` |
| `workspace.destroy` | `{ workspaceId }` | `{ ok }` |
| `pty.spawn` | `{ workspaceId, command, args }` | `{ ptyId }` |
| `pty.write` | `{ ptyId, data }` | `{ ok }` |
| `pty.resize` | `{ ptyId, cols, rows }` | `{ ok }` |
| `pty.kill` | `{ ptyId }` | `{ ok }` |
| `messages.list` | `{ sessionId, limit, offset }` | `Message[]` |
| `messages.append` | `{ sessionId, role, content }` | `{ id }` |
| `config.load` | `{ projectPath }` | `MaverickConfig` |
| `skills.list` | `{ projectPath }` | `Skill[]` |
| `skills.run` | `{ workspaceId, skillName, vars }` | `{ prompt: string }` |
| `diff.get` | `{ worktreePath, filePath? }` | `DiffResult` |
| `diff.stage_hunk` | `{ worktreePath, patch }` | `{ ok }` |
| `diff.unstage_hunk` | `{ worktreePath, patch }` | `{ ok }` |
| `git.log` | `{ worktreePath, limit }` | `Commit[]` |
| `git.stash_list` | `{ worktreePath }` | `Stash[]` |
| `git.commit` | `{ worktreePath, message, files }` | `{ sha }` |
| `kanban.list` | `{ projectId }` | `KanbanTask[]` |
| `kanban.upsert` | `{ task }` | `KanbanTask` |
| `automation.run` | `{ automationName, workspaceId }` | `{ ok }` |
| `mcp.start` | `{ name }` | `{ pid }` |
| `mcp.stop` | `{ name }` | `{ ok }` |
| `notify.send` | `{ title, body, workspaceId }` | `{ ok }` |
| `context.usage` | `{ sessionId }` | `ContextUsage` |
| `attachment.create` | `{ worktreePath, text }` | `{ filePath, ref }` |
| `preset.list` | `{ projectPath? }` | `WorkspacePreset[]` |
| `preset.launch` | `{ preset, projectId, branch? }` | `{ workspaceId }` |
| `preset.save_current` | `{ workspaceId, name }` | `WorkspacePreset` |

### 4.4 Tauri Commands (Rust → React bridge)

```rust
// src-tauri/src/commands/
workspace_create(project_id, branch, backend) -> WorkspaceResult
workspace_destroy(workspace_id) -> Result
pty_spawn(workspace_id, command, args) -> PtyResult
pty_write(pty_id, data) -> Result
pty_resize(pty_id, cols, rows) -> Result
config_load(project_path) -> ConfigResult
messages_list(session_id, limit, offset) -> Vec<Message>
```

**Tauri events (Rust → React, streamed):**

| Event | Payload |
|---|---|
| `pty:data` | `{ ptyId: string; data: string }` |
| `pty:exit` | `{ ptyId: string; code: number }` |
| `workspace:status` | `{ workspaceId: string; status: string }` |

### 4.5 TerminalProvider Abstraction

All terminal rendering is gated behind a `TerminalProvider` interface. `TerminalPane` never imports xterm.js directly — it calls the provider. Swapping to Ghostty or any other renderer requires only a new provider class and a settings change; zero changes to `SplitPane`, `TerminalView`, `usePty`, or any other consumer.

```typescript
// lib/terminal-provider.ts

interface TerminalProvider {
  /** Mount the terminal into the given DOM container */
  mount(container: HTMLElement, options: TerminalOptions): TerminalHandle
}

interface TerminalHandle {
  /** Write raw bytes/string from PTY stdout to the display */
  write(data: string | Uint8Array): void
  /** Resize the terminal to match new container dimensions */
  resize(cols: number, rows: number): void
  /** Apply a theme update (colors, font) without remounting */
  setTheme(theme: TerminalTheme): void
  /** Focus the terminal for keyboard input */
  focus(): void
  /** Clean up — called when pane is destroyed (not on tab switch) */
  dispose(): void
  /** Returns current { cols, rows } */
  readonly dimensions: { cols: number; rows: number }
}

interface TerminalOptions {
  theme: TerminalTheme
  fontSize: number
  fontFamily: string
  ligatures: boolean
  scrollback: number
}

interface TerminalTheme {
  background: string
  foreground: string
  cursor: string
  black: string; red: string; green: string; yellow: string
  blue: string; magenta: string; cyan: string; white: string
  brightBlack: string; brightRed: string; brightGreen: string
  brightYellow: string; brightBlue: string; brightMagenta: string
  brightCyan: string; brightWhite: string
}
```

**Concrete implementations:**

| Class | Renderer | Status |
|---|---|---|
| `XtermProvider` | xterm.js v5 | Default — ships in v0.1 |
| `GhosttyProvider` | libghostty (Rust FFI via Tauri) | v0.2 |
| `NativeProvider` | OS terminal embedding | Future |

**Registration** in `App.tsx`:
```typescript
// Only one import needs to change to swap renderers
import { XtermProvider } from './lib/providers/xterm-provider'
TerminalRegistry.register(new XtermProvider())
```

`TerminalPane.tsx` calls `TerminalRegistry.get().mount(ref.current, options)` — no renderer-specific code anywhere else in the React tree.

### 4.6 Terminal Split Algorithm

Max 6 leaf nodes. Split enforcement:

```typescript
function countLeaves(node: SplitNode): number {
  if (node.type === 'terminal') return 1
  return countLeaves(node.left) + countLeaves(node.right)
}

function canSplit(tree: SplitNode): boolean {
  return countLeaves(tree) < 6
}
```

Default 6-pane layout (3 cols × 2 rows) built as nested SplitNodes:
```
split(v, 0.5,           ← top row / bottom row
  split(h, 0.33,        ← top: 3 columns
    terminal(1),
    split(h, 0.5,
      terminal(2),
      terminal(3)
    )
  ),
  split(h, 0.33,        ← bottom: 3 columns
    terminal(4),
    split(h, 0.5,
      terminal(5),
      terminal(6)
    )
  )
)
```

---

## 5. Database Schema

```sql
-- SQLite via bun:sqlite
-- Location: ~/Library/Application Support/maverick/db.sqlite

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  path        TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE workspaces (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  branch          TEXT NOT NULL,
  agent_backend   TEXT NOT NULL,
  worktree_path   TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'idle',  -- active | idle | error
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
  started_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  ended_at      INTEGER
);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES sessions(id),
  role            TEXT NOT NULL,  -- user | assistant | tool
  content         TEXT NOT NULL,
  tool_calls_json TEXT,           -- JSON blob, nullable
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE backends (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  command     TEXT NOT NULL,
  args_json   TEXT NOT NULL DEFAULT '[]',
  env_json    TEXT NOT NULL DEFAULT '{}',
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE workspace_presets (
  id            TEXT PRIMARY KEY,
  project_id    TEXT REFERENCES projects(id),  -- NULL = global preset
  name          TEXT NOT NULL,
  description   TEXT,
  base_branch   TEXT,
  layout_json   TEXT NOT NULL,  -- JSON-serialised PresetNode tree
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_presets_project ON workspace_presets(project_id);

CREATE TABLE kanban_tasks (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  title         TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'backlog',  -- backlog | in_progress | review | done
  column_order  REAL NOT NULL DEFAULT 0,
  workspace_id  TEXT REFERENCES workspaces(id),
  labels_json   TEXT NOT NULL DEFAULT '[]',
  due_date      INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE notifications (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT REFERENCES workspaces(id),
  type          TEXT NOT NULL,  -- waiting | complete | error | quota
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  read          INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE context_usage (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES sessions(id),
  tokens_used     INTEGER NOT NULL DEFAULT 0,
  context_window  INTEGER NOT NULL DEFAULT 200000,
  cost_estimate   REAL NOT NULL DEFAULT 0.0,
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE repo_configs (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) UNIQUE,
  workspaces_path   TEXT,
  base_branch       TEXT NOT NULL DEFAULT 'origin/main',
  remote_origin     TEXT NOT NULL DEFAULT 'origin',
  preview_url       TEXT,
  files_to_copy     TEXT NOT NULL DEFAULT '[]',  -- JSON array
  setup_script      TEXT,
  run_script        TEXT,
  archive_script    TEXT,
  instructions      TEXT,   -- MAVERICK.md override stored here
  review_prefs      TEXT,   -- JSON
  pr_prefs          TEXT,   -- JSON
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_messages_session ON messages(session_id, created_at);
CREATE INDEX idx_workspaces_project ON workspaces(project_id);
CREATE INDEX idx_kanban_project ON kanban_tasks(project_id, status);
CREATE INDEX idx_notifications_workspace ON notifications(workspace_id, read);
```

---

## 6. REST API Routes

> Maverick has no external HTTP API in v0.1. All communication is local IPC (Tauri commands + Tauri events). This section documents the **Bun sidecar JSON-RPC interface** for reference.

**Transport:** Unix socket (`~/.maverick/sidecar.sock`) or stdio pipe.  
**Format:** JSON-RPC 2.0.

```
→ { "jsonrpc": "2.0", "id": 1, "method": "workspace.create", "params": { ... } }
← { "jsonrpc": "2.0", "id": 1, "result": { ... } }

→ { "jsonrpc": "2.0", "id": 2, "method": "pty.spawn", "params": { "workspaceId": "ws_abc", "command": "claude", "args": [] } }
← { "jsonrpc": "2.0", "id": 2, "result": { "ptyId": "pty_xyz" } }

// Streaming event (no id — notification)
← { "jsonrpc": "2.0", "method": "pty.data", "params": { "ptyId": "pty_xyz", "data": "..." } }
```

---

## 7. Package Dependencies

### Frontend (`package.json`)

```json
{
  "dependencies": {
    "@tauri-apps/api": "^2.x",
    "@tauri-apps/plugin-shell": "^2.x",
    "react": "^19.x",
    "react-dom": "^19.x",
    "@xterm/xterm": "^5.x",
    "@xterm/addon-fit": "^0.10.x",
    "@xterm/addon-web-links": "^0.10.x",
    "@xterm/addon-search": "^0.10.x",
    "tailwindcss": "^4.x",
    "framer-motion": "^12.x",
    "zustand": "^5.x",
    "js-yaml": "^4.x",
    "diff2html": "^3.x",
    "tinykeys": "^2.x",
    "react-markdown": "^9.x",
    "remark-gfm": "^4.x",
    "highlight.js": "^11.x",
    "pdfjs-dist": "^4.x",
    "@hello-pangea/dnd": "^16.x",
    "react-element-inspector": "^1.x",
    "date-fns": "^3.x"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.x",
    "vite": "^6.x",
    "typescript": "^5.x",
    "@types/react": "^19.x"
  }
}
```

### Bun Sidecar (`sidecar/package.json`)

```json
{
  "dependencies": {
    "js-yaml": "^4.x",
    "zod": "^3.x"
  }
}
```
> `bun:sqlite` and PTY APIs are built into Bun — no npm packages needed.

### Rust (`Cargo.toml`)

```toml
[dependencies]
tauri = { version = "2", features = ["shell-open"] }
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
```

---

## 8. Frontend Architecture

```
src/
├── main.tsx                    # React entry point
├── App.tsx                     # Root layout — ThemeProvider + KeyboardShortcutHandler + TitleBar + AppBody
├── context/
│   └── WorkspaceContext.tsx    # Global state (Zustand store + React context)
├── lib/stores/
│   └── settings.ts             # useSettings(key, default) hook backed by a typed SettingsKey enum; 250 ms debounced persist via settings_write
├── components/
│   ├── titlebar/
│   │   ├── TitleBar.tsx
│   │   └── WorkspaceBadges.tsx
│   ├── sidebar/
│   │   ├── Sidebar.tsx
│   │   ├── ProjectList.tsx
│   │   ├── ProjectItem.tsx
│   │   ├── WorkspaceItem.tsx
│   │   └── BackendStatus.tsx
│   ├── center/
│   │   ├── CenterPanel.tsx
│   │   ├── WorkspaceTabBar.tsx
│   │   ├── WorkspacePanel.tsx      # Keep-alive wrapper
│   │   ├── agent/
│   │   │   ├── AgentView.tsx
│   │   │   ├── MessageList.tsx
│   │   │   ├── ToolCallSummary.tsx
│   │   │   ├── AgentResponse.tsx
│   │   │   └── InputBar.tsx        # includes /skill autocomplete
│   │   └── terminal/
│   │       ├── TerminalView.tsx    # ⌘T toggle target
│   │       ├── SplitPane.tsx       # Recursive SplitNode renderer
│   │       └── TerminalPane.tsx    # calls TerminalRegistry.get().mount() — renderer-agnostic
│   └── rightpanel/
│       ├── RightPanel.tsx
│       ├── FileTree.tsx
│       ├── DiffViewer.tsx          # diff2html renderer, hunk stage/unstage
│       └── TerminalSubPanel.tsx
├── themes/
│   ├── theme-provider.tsx          # Injects CSS custom properties from active theme
│   ├── definitions/                # One JSON file per theme
│   │   ├── maverick-dark.json
│   │   ├── one-dark-pro.json
│   │   ├── dracula.json
│   │   ├── nord.json
│   │   ├── catppuccin-mocha.json
│   │   ├── catppuccin-latte.json
│   │   ├── tokyo-night.json
│   │   ├── monokai-pro.json
│   │   ├── github-dark.json
│   │   ├── github-light.json
│   │   ├── solarized-dark.json
│   │   └── gruvbox-dark.json
│   └── types.ts
├── shortcuts/
│   ├── registry.ts                 # tinykeys binding map, all actions
│   └── keybinding-help.tsx         # ⌘⇧K modal overlay
├── panels/
│   ├── git/
│   │   ├── GitPanel.tsx
│   │   ├── CommitLog.tsx
│   │   ├── StagingArea.tsx
│   │   ├── StashList.tsx
│   │   ├── BlameView.tsx
│   │   └── ConflictResolver.tsx
│   ├── browser/
│   │   ├── BrowserPanel.tsx        # Tauri WebviewWindow host
│   │   ├── BrowserToolbar.tsx      # URL bar, back/forward/refresh
│   │   └── ElementInspector.tsx    # WYSIWYG element capture → input bar
│   ├── kanban/
│   │   ├── KanbanBoard.tsx
│   │   ├── KanbanColumn.tsx
│   │   └── KanbanCard.tsx
│   ├── presets/
│   │   ├── PresetPicker.tsx         # ⌘⇧Space fuzzy launcher — name, description, layout thumbnail
│   │   ├── PresetEditor.tsx         # visual layout builder (drag-and-drop pane tree)
│   │   └── PresetThumbnail.tsx      # small SVG preview of the SplitNode layout
│   ├── automations/
│   │   ├── AutomationsPanel.tsx
│   │   ├── AutomationBuilder.tsx   # visual step editor
│   │   └── AutomationRunner.tsx
│   ├── mcps/
│   │   ├── MCPsPanel.tsx
│   │   └── MCPServerCard.tsx
│   ├── preview/
│   │   ├── FilePreviewPanel.tsx    # router: dispatch by MIME type
│   │   ├── MarkdownPreview.tsx     # react-markdown + remark-gfm + highlight.js
│   │   ├── PDFPreview.tsx          # pdfjs-dist
│   │   └── ImagePreview.tsx        # zoom/pan canvas
│   └── settings/
│       ├── SettingsPanel.tsx       # sidebar nav + section router
│       ├── sections/
│       │   ├── GeneralSettings.tsx
│       │   ├── ModelsSettings.tsx
│       │   ├── AppearanceSettings.tsx  # theme picker, font size, ligatures
│       │   ├── NotificationsSettings.tsx
│       │   ├── KeybindingsSettings.tsx
│       │   ├── GitSettings.tsx
│       │   ├── MCPsSettings.tsx
│       │   ├── AdvancedSettings.tsx
│       │   ├── TerminalPresets.tsx  # like Conductor's "Big terminal" section
│       │   ├── AccountSettings.tsx
│       │   └── RepositorySettings.tsx  # per-repo config panel
│       └── RepoConfig.tsx          # paths, scripts, AI preferences per repo
├── hooks/
│   ├── usePty.ts               # PTY lifecycle + TerminalProvider binding (renderer-agnostic)
│   ├── useWorkspace.ts         # Workspace CRUD
│   ├── useConfig.ts            # maverick.yaml loader
│   ├── useTheme.ts             # Theme read/write, custom import
│   ├── useSkills.ts            # Skills list + /skill invocation
│   └── usePresets.ts           # Preset list, launch, save-current-layout
├── lib/
│   ├── tauri.ts                # Typed wrappers for Tauri invoke/listen
│   ├── splitnode.ts            # SplitNode tree operations
│   ├── ipc.ts                  # IPC type definitions
│   ├── terminal-provider.ts    # TerminalProvider interface + TerminalRegistry singleton
│   └── providers/
│       ├── xterm-provider.ts   # xterm.js implementation of TerminalProvider (default)
│       └── ghostty-provider.ts # libghostty implementation (stub, activated in v0.2)
└── styles/
    ├── globals.css             # CSS custom properties, glass mixins
    ├── glass.css               # .glass mixin: backdrop-filter + bg-alpha
    └── terminal.css
```

---

## 9. Backend Architecture (Bun Sidecar)

```
sidecar/
├── index.ts                  # JSON-RPC server, stdio transport
├── process-manager.ts        # PTY spawn, I/O, lifecycle
├── worktree-manager.ts       # git worktree add/remove/prune
├── sqlite-store.ts           # DB init + CRUD queries
├── config-loader.ts          # maverick.yaml + maverick.json parser + Zod validation
├── skills-engine.ts          # Template variable interpolation ({{file}}, {{diff}}, etc.)
├── diff-reader.ts            # git diff parser, patch formatting for stage/unstage
├── rpc-handlers.ts           # JSON-RPC method dispatch table
└── types.ts                  # Shared interfaces
```

---

## 10. Theme & Glassmorphism System

### 10.1 Theme Application

Themes inject a flat map of CSS custom properties onto `:root` via `ThemeProvider`:

```css
:root {
  --bg-base: #0f0f1a;
  --bg-panel: rgba(15, 15, 26, 0.75);   /* glass alpha variant */
  --bg-sidebar: rgba(10, 10, 20, 0.80);
  --accent: #7c3aed;
  --accent-muted: rgba(124, 58, 237, 0.2);
  --text-primary: #e2e8f0;
  --text-muted: #64748b;
  --border: rgba(45, 45, 74, 0.6);
  --success: #4ade80;
  --error: #f87171;
  --warn: #fbbf24;
}
```

The `terminal` key of each theme maps to the `TerminalTheme` interface defined in `lib/terminal-provider.ts` and is passed to the active `TerminalProvider` via `handle.setTheme()`. The provider is responsible for translating `TerminalTheme` into its own internal color format — xterm.js maps it to `ITheme`; Ghostty maps it to its Zig color config. Theme consumers never import renderer-specific types.

### 10.2 Glassmorphism CSS Mixin

All glass surfaces use a shared mixin from `glass.css`:

```css
.glass {
  background: var(--bg-panel);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid var(--border);
}

.glass-heavy {
  background: var(--bg-sidebar);
  backdrop-filter: blur(24px) saturate(200%);
  -webkit-backdrop-filter: blur(24px) saturate(200%);
}
```

Applied to: `Sidebar`, `TitleBar`, `WorkspaceTabBar`, `RightPanel`, `InputBar`, modals, tooltips, command palette, theme picker, and all popovers. Not applied to terminal panes (xterm.js manages its own canvas).

### 10.3 Font Loading

Geist Mono (Regular, Medium, SemiBold, Bold) and Geist Mono Nerd Font (for terminal glyphs/powerline) are bundled in `src/assets/fonts/` and declared in `globals.css` via `@font-face`. No network requests for typography. Font size and ligature toggle exposed in `Settings → Appearance`.

### 10.4 Sidebar Panel Architecture

The left sidebar contains icon slots for each major panel module. The active panel replaces the main content area or opens as a sliding overlay depending on panel type:

| Icon | Panel | Mode |
|---|---|---|
| ◈ | Dashboard / Workspaces | Main |
| ⌥ | Git Module | Main |
| ☰ | Kanban Board | Main |
| ⚡ | Automations | Overlay |
| 🔌 | MCPs | Overlay |
| ◻ | Browser | Main |
| ⚙ | Settings | Full overlay |

Each panel is lazily mounted on first open, then kept in DOM (same keep-alive strategy as workspaces).

---

## 11. Database Architecture

- **Engine:** SQLite via `bun:sqlite` (built into Bun, zero dependency)
- **Location:**
  - macOS: `~/Library/Application Support/maverick/db.sqlite`
  - Linux: `~/.local/share/maverick/db.sqlite`
  - Windows: `%APPDATA%\maverick\db.sqlite`
- **Migrations:** Sequential `.sql` files in `sidecar/migrations/`, run on sidecar startup
- **WAL mode:** Enabled (`PRAGMA journal_mode=WAL`) for concurrent reads during PTY streaming
- **Backup:** User-managed; Maverick exposes "Export DB" in settings (v0.2)

---

## 12. Companion Server (Remote Access)

The desktop IDE *is* the companion server. A phone, tablet, or second laptop
attaches as a thin client over a WebSocket and drives the same sessions the
desktop drives — "your laptop is the server, anything else is a client." This
**supersedes the standalone `MaverickAgent` menu-bar daemon** (now deprecated;
see `maverick-app/server/DEPRECATED.md`), folding its role into the Rust core
under `src-tauri/src/remote/` so there is one source of truth for sessions,
auth, and the wire protocol.

### 12.1 Why it lives in the Rust core

- **No second process to install or trust.** The PTYs, ring buffers, git, and
  file RPC already live in-process; the server tees them rather than re-hosting.
- **Real auth, finally.** `MaverickAgent` shipped a no-op token. The IDE server
  does X25519/Noise_XX QR pairing + a per-device token gate + capability scope.
- **Off by default, loopback by default.** The WS listener binds `127.0.0.1`
  and is disabled until the user starts it from Settings → Remote.

### 12.2 Module map (`src-tauri/src/remote/`)

| Module | Responsibility |
|---|---|
| `ws_server.rs` | tokio-tungstenite listener; start/revoke lifecycle; loopback-by-default bind |
| `connection.rs` | Per-socket read/write loop; frame codec; auth gate (close `4401` on failure) |
| `protocol.rs` | `serde` port of `MaverickProtocol` — the wire contract shared with the client |
| `agent_event.rs` + `adapters/{claude,codex,heuristic}.rs` | Normalise each backend's stream into provider-agnostic `AgentEvent`s (Claude rich-stream + Codex `--json` full; OpenCode/Antigravity/Hermes heuristic) |
| `agent_host.rs` | Bridges a remote session to a running agent process |
| `hook_server.rs` | `localhost:7789` Claude-hook receiver; blocking `PermissionRequest` (fail-closed), bound to `(session_id, request_id)`; idempotent `~/.claude/settings.json` merge |
| `bridge.rs` | Forwards git / file / directory RPC to the IDE's existing handlers |
| `pairing.rs` | Noise_XX handshake over the QR-exchanged ephemeral key (`snow`) |
| `auth.rs` / `auth_session.rs` | Token issue/verify; per-connection capability scope |
| `device_store.rs` | TOFU device pinning; constant-time token compare (`subtle`); `0600` atomic key file |
| `transport.rs` | `RemoteDialer` trait — LAN/mDNS today, iroh P2P stubbed behind it |
| `session_registry.rs` | Maps live sessions so a client can attach/detach without restarting a PTY |

### 12.3 Session continuity — the ring buffer

Each PTY owns a bounded **ring buffer** (`pty/ring.rs`, `RING_CAP = 1 MiB`).
On client attach, the server replays the last `REPLAY_CAP = 256 KiB` so a phone
that connects mid-run sees recent scrollback immediately instead of a blank
pane. The same primitive powers desktop⇄phone **handoff**: start a task on one
client, attach from another, and the replay + live tee reconstruct the view with
no re-prompting. Writes are coalesced (4 ms window) and UTF-8 boundary-safe.

### 12.4 Connectivity tiers (the Tailscale replacement)

```
Tier 1  LAN + mDNS        same network; zero-config discovery, lowest latency
Tier 2  iroh P2P (DERP)   NAT-traversed direct path; free relay fallback  [stubbed behind RemoteDialer]
Tier 3  Relay (DO)        last-resort store-and-forward                   [planned]
```

Noise session keys are **transport-independent**: pairing happens once (QR), and
the same encrypted session rides whichever tier connects. Tailscale is demoted
from a hard dependency to an optional Tier-2 alternative, not a prerequisite.

### 12.5 Pairing flow

```
Desktop (server)                         Phone (client)
  Settings → Remote → "Pair device"
  generate ephemeral X25519 keypair
  render QR { host, port, pubkey, nonce } ──scan──▶ decode QR
                                                    Noise_XX handshake ◀──▶ handshake
  TOFU-pin device pubkey                            derive session key
  issue scoped per-device token       ──────────▶  store token (Keychain/SecureStore)
  ◀───────────── authed WS (close 4401 on bad token) ─────────────▶
```

`remote_start` / `remote_pair` / `remote_revoke` are the Tauri commands that the
Settings UI calls; revoke drops the device's pin and invalidates its token.

---

## 13. React Native Client (`maverick-app/mobile`)

The mobile/web client is **Expo + react-native-web**, sharing a TypeScript port
of `MaverickProtocol` with the desktop. One codebase targets iOS, Android, and
the browser (the long-term "anything is a client" goal). It carries the same
Noise_XX pairing, a `ConnectionManager` over the tier ladder above, agent chat,
git/file surfaces, and a terminal rendered in a WebView (xterm.js) fed by the
ring-buffer replay + live tee. The wire contract is byte-for-byte identical to
the desktop's, so the client is renderer-only — all session authority stays on
the host.
