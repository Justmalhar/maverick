# AGENTS.md — guidance for AI agents working in Maverick

This file captures the non-obvious things an AI agent needs to be productive here. **`CLAUDE.md` is the authoritative source for conventions** (terminology, design tokens, layer boundaries, file ownership). Read it first. This file only adds what `CLAUDE.md` and `README.md` don't make obvious.

## Golden rules (most-violated first)

1. **bun, never npm/yarn/pnpm.** `bun install`, `bun run`, `bunx`, `bun test`.
2. **Cross-layer contracts must move together.** A wire payload touches three layers: `src/lib/tauri.ts` (React wrapper) → `src-tauri/src/commands/*.rs` (Rust pass-through) → `sidecar/rpc-handlers.ts` (Zod-validated handler). If you add or change a field, change all three **and** the Zod schema, or you get a silent runtime failure. Frontend tests mock `invoke()` and sidecar tests inject params directly, so neither catches a cross-layer drift on its own — add/adjust tests at each layer.
4. **Every public function needs a test.** Coverage is CI-gated at **100% lines / 95% branches / 100% functions / 100% statements**. New code must keep the global aggregate above those thresholds.
5. **No API keys, ever.** Backends read their own CLI config. If you find yourself reading a key, stop.

## How the layers talk

```
React (src/) ──Tauri invoke──▶ Rust (src-tauri/) ──JSON-RPC/stdio──▶ Bun sidecar (sidecar/)
                                                                       └─ PTYs, git worktrees, SQLite, config, MCP
```

- Rust is a **dumb pass-through**: it forwards `invoke("foo_bar", {...})` to the sidecar method `foo.bar` and forwards events back. Sidecar emits a JSON-RPC notification `a.b.c`; Rust rebroadcasts it to the webview as the Tauri event `a:b:c` (dots → colons). Subscribe in React via `listen("a:b:c", …)`.
- Tauri auto-converts JS camelCase command args to Rust snake_case params. Sidecar params stay camelCase.

## Adding a new IPC command (the recipe)

1. **Sidecar:** add a `Schemas.foo` Zod object + a `case "foo.bar":` in `sidecar/rpc-handlers.ts`, delegating to a module class. Add a `bun test` case.
2. **Rust:** add `commands/<group>.rs::foo_bar` (forwards `json!({...})` to `"foo.bar"`), re-export in `commands/mod.rs`, and register in the `invoke_handler!` list in `src-tauri/src/lib.rs`.
3. **React:** add a typed wrapper in `src/lib/tauri.ts`; mirror any new type in **both** `src/lib/ipc.ts` and `sidecar/types.ts`.
4. **Tests:** sidecar dispatch test + `src/lib/tauri.test.ts` wrapper-shape assertion + a component/hook test for the consumer.

## State, settings, events

- Global UI state is the Zustand store `src/state/store.ts` (`useWorkbench`). Selectors live at the bottom of that file. Some derived logic is pure-exported (e.g. `computeLiveWorkspaceIds`) so it can be unit-tested without React.
- App settings: `useSettings(key, default)` from `src/lib/stores/settings.ts`; keys are typed in `src/lib/ipc.ts` (`SettingsKey`) with defaults in `src/lib/stores/settings-defaults.ts`. Use `_resetSettingsStoreForTests()` in test `beforeEach`.
- Cross-component signals use window `CustomEvent`s, e.g. `maverick:context:updated`, `maverick:panel:tab`, `maverick:terminal:clear`. Keep listeners cleaned up in effect teardown.

## Terminals / PTYs

- Never import xterm.js outside `src/lib/providers/`. Go through `TerminalRegistry.get()`.
- A workspace's agent PTY id **is** the workspace id. `pty.spawn` defaults its cwd to the workspace's worktree path when `cwd` is omitted.
- Editor groups are **keep-alive** (`display:none`, never unmounted) so PTYs survive tab switches — except the LRU tail beyond `advanced.lruLimit`, which is suspended (DOM destroyed; the sidecar PTY persists and reconnects on re-focus). Modules that cache PTYs at module scope (e.g. `BottomTerminal`'s `ptyCache`) export a `__testing__` handle — clear it in test `beforeEach` to avoid cross-test leakage.

## Testing gotchas

- `invoke()` and `listen()` are mocked globally (`src/test/setup.ts`). Prefer `mockImplementation((cmd) => …)` keyed by command name over ordered `mockResolvedValueOnce` — a single feature often fires several `invoke` calls (e.g. a view load also records context usage), and ordered mocks break when call order shifts.
- To cover `if (cancelled) return` guards in async effects, render then `unmount()` before resolving a deferred promise.
- **Memory-starved machines:** lazy-loaded panels (`KanbanBoard`, `SettingsPanel`, `ProjectSettingsPanel`, …) can blow their `waitFor` timeout under load and fail non-deterministically. This is environmental, not a code regression — run `bunx vitest run --no-file-parallelism`, or run the affected file in isolation, to get a clean signal.

## Where to look

- `PRD.md` — what to build (v0.1 scope).
- `SYSTEM-DESIGN.md` — HLD/LLD, RPC routes, DB schema.
- `todo.md` — phase-by-phase implementation status (kept current).
- `CLAUDE.md` — conventions, canonical VSCode terminology, design tokens, file-ownership zones for parallel agents.
