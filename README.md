# Maverick

A native desktop IDE that orchestrates AI coding CLIs (Claude Code, Codex, Gemini, Aider, Ollama, …) inside a familiar VSCode-style workbench. Each task runs in its own isolated **git worktree** with a live agent conversation, terminal, diff view, and one-click PR — so you can run many agents in parallel without them stepping on each other.

Built with **Tauri v2** (Rust shell), a **React 19** webview, and a **Bun sidecar** that owns PTYs, git worktrees, SQLite, and config.

---

## Highlights

- **Workspaces = git worktrees.** Spin up an isolated branch + working copy per task; PTYs survive tab switches (keep-alive), and an LRU window suspends the least-recently-used editors once you cross the configured limit.
- **Agent mode & Terminal mode** per workspace, toggle with `⌘T`.
- **VSCode-style chrome:** ActivityBar, PrimarySideBar, EditorGroups/Tabs, AuxiliaryBar (files + diff), bottom Panel (Setup / Run / Terminal), StatusBar, Command Palette (`⌘⇧P`), Quick Open (`⌘P`), Preset Launcher (`⌘⇧Space`).
- **AI workflows:** `⌘⇧R` runs an AI code review of the working diff; one-click **Create PR** via `gh`.
- **Instruction injection:** the first prompt of a fresh session is prefixed with your project `MAVERICK.md` → `CLAUDE.md` → `AGENTS.md` (first match wins) plus the global `~/.maverick/MAVERICK.md`.
- **Skills, Automations, MCP servers, Kanban, Browser, file previewers,** and a theme engine with 14 bundled themes.
- **No API keys in Maverick.** Every backend authenticates through its own CLI config (`~/.claude.json`, `~/.config/codex`, …).

For the full product spec see `PRD.md`; for architecture see `SYSTEM-DESIGN.md`. Agent-specific contribution rules live in `CLAUDE.md` and `AGENTS.md`.

---

## Requirements

- **[Bun](https://bun.sh)** ≥ 1.3 — the package manager and sidecar runtime. **Do not use npm/yarn/pnpm.**
- **Rust** (stable) + the Tauri v2 prerequisites for your OS — see <https://tauri.app/start/prerequisites/>.
- At least one agent CLI on your `PATH` (e.g. `claude`, `codex`, `gemini`), already authenticated.
- `git`, and `gh` (GitHub CLI) if you want the Create-PR flow.

Developed on macOS (Apple Silicon); Linux is supported, Windows is best-effort.

---

## Getting started

```bash
bun install            # install JS deps
bun run tauri dev      # launch the app (Rust + Vite + sidecar)
```

`bun run tauri dev` builds the Rust shell, starts the Vite dev server for the webview, and spawns the Bun sidecar. The first Rust compile takes a few minutes; subsequent runs are fast.

To produce a distributable bundle:

```bash
bun run tauri:build    # builds the sidecar, then `tauri build`
```

---

## Project layout

```
src/                 React webview (components, panels, hooks, state, styles)
src-tauri/           Rust Tauri core — JSON-RPC pass-through + event forwarding
  src/commands/      one module per IPC command group
sidecar/             Bun sidecar — PTYs, git worktrees, SQLite, config, skills, MCP
  migrations/        SQLite schema migrations
scripts/             build helpers (e.g. sidecar bundler)
```

The three layers talk over a strict boundary: **React → Tauri commands → sidecar JSON-RPC over stdio.** React never touches the sidecar directly; Rust never parses YAML, touches SQLite, or spawns CLIs. Cross-layer types are mirrored in `src/lib/ipc.ts` (React) and `sidecar/types.ts` (Bun).

---

## Testing

```bash
bun run typecheck        # tsc --noEmit
bun run test:coverage    # Vitest (React + TS) with coverage thresholds
bun run test:sidecar     # bun test (sidecar)
bun run test:rust        # cargo test (Rust)
bun run test:all         # all three, in order
```

Coverage thresholds are CI-enforced: **100% lines / 95% branches / 100% functions / 100% statements.** Every public function ships with a test.

> Tip: on a memory-constrained machine the Vitest suite can hit `waitFor` timeouts on lazy-loaded panels. Run `bunx vitest run --no-file-parallelism` to serialize files and lower peak memory.

---

## Configuration

- **Per-repo:** `maverick.json` at a project root (workspaces path, base branch, remote, preview URL, files-to-copy, setup/run/archive scripts, AI preferences). `maverick.yaml` defines skills, automations, and MCP servers.
- **Global:** `~/.maverick/` holds `settings.json`, `MAVERICK.md` (global instructions), and `themes/`.

---

## License

See repository for license details.
