# Maverick — Core Setup Design

**Date:** 2026-05-20  
**Author:** Malhar Ujawane  
**Status:** Approved

---

## 1. Product Scope (v0.1)

Maverick is a native desktop app (macOS-first) that acts as the OS layer above AI coding CLIs — Claude Code, Codex, Gemini CLI, Aider, Ollama, and custom. Zero inference cost: Maverick never calls AI APIs directly, only spawns CLI subprocesses.

**v0.1 deliverables:**
- CLI dispatcher (Bun sidecar, `Bun.spawn()`)
- `maverick.yaml` per-repo config
- Git worktree isolation per workspace
- Projects sidebar + workspace switcher
- xterm.js terminal with 6-pane tmux-style grid (`⌘T` toggle)
- `getmaverick.sh` curl installer

**Explicitly out of scope for v0.1:** diff viewer, YAML skills engine, Ghostty swap, Windows/Linux support, auth/billing, AI micro-features.

---

## 2. Stack

| Layer | Choice |
|---|---|
| Desktop shell | Tauri v2 (Rust) |
| UI | React 19 + Tailwind + Vite (Bun) |
| Process orchestration | Bun sidecar (TypeScript) |
| Terminal renderer | xterm.js (Ghostty in v0.2 via `TerminalProvider`) |
| Database | SQLite via `bun:sqlite` |
| Config | `maverick.yaml` (required) + `maverick.json` (optional) |
| Git isolation | `git worktree` per workspace |
| Distribution | `getmaverick.sh` curl installer |

---

## 3. UI Layout

Three-panel layout modelled on Conductor + BridgeSpace:

- **Left sidebar (220px):** Project tree → workspace items (branch + agent + status) → backend status footer. Nav: Dashboard, History.
- **Center panel (flex):** Tab bar per workspace. `⌘T` toggles:
  - *Agent mode:* conversation history, tool call summaries, diffs, input bar
  - *Terminal mode:* up to 6 xterm.js panes in 3×2 grid (binary SplitNode tree)
- **Right panel (260px):** File tree with M/A/D indicators + Setup/Run/Terminal sub-panel

**Keep-alive:** All WorkspacePanel components mounted, `display:none` when inactive. PTYs never killed. `Cmd+[/]` switching < 10ms.

---

## 4. Architecture

```
Tauri v2 (Rust shell)
  ├── React UI (Vite/React 19)
  │     ├── WorkspaceContext (keep-alive panels)
  │     ├── xterm.js (SplitNode tree, max 6 panes)
  │     └── Tauri invoke() → IPC bridge
  └── Bun Sidecar (TypeScript)
        ├── Bun.spawn() → CLI subprocesses
        ├── bun:sqlite → SQLite
        └── git worktree management

Subprocesses: claude-code | codex | gemini | aider | ollama | custom
```

IPC flow: React → `invoke()` → Rust → JSON-RPC → Bun sidecar → `Bun.spawn()` → CLI. PTY output streams back via Tauri events → xterm.js.

---

## 5. Data Model

```sql
projects    (id, name, path, created_at)
workspaces  (id, project_id, branch, agent_backend, worktree_path, status, created_at)
sessions    (id, workspace_id, started_at, ended_at)
messages    (id, session_id, role, content, tool_calls_json, created_at)
backends    (id, name, command, args_json, env_json, active)
```

---

## 6. Terminal Split Model

Binary SplitNode tree (tmux internals model):

```typescript
type SplitNode =
  | { type: 'terminal'; id: string; backend: string }
  | { type: 'split'; direction: 'h' | 'v'; ratio: number; left: SplitNode; right: SplitNode }
```

Max 6 leaf nodes. Default layout for 6: 3 columns × 2 rows. Active pane: `#7c3aed` outline.

---

## 7. Key Constraints

- No API calls from Maverick — CLI subprocess only
- Per-repo `maverick.yaml` committed to version control
- LRU suspension after 20+ open workspaces (destroys render surfaces, NOT PTY processes)
- `TerminalProvider` abstraction from day one (xterm.js now, Ghostty later)
