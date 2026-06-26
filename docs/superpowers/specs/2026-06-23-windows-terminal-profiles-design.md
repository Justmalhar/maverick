# Windows terminal profiles + sidecar/shell fixes — Design

*Date: 2026-06-23 · Status: approved*

## Problem

Running `target\debug\maverick.exe` on Windows produces three failures:

1. **Sidecar won't start** — `failed to spawn sidecar 'bun': program not found`. `bun` v1.3.12 is
   installed, but only as an npm-global shim (`bun.cmd` + an extensionless script); there is no
   `bun.exe`. Rust's `Command::new("bun")` (via `CreateProcessW`) appends only `.exe` and does not
   consult `PATHEXT`, so the `.cmd` shim is invisible. The whole app drops to degraded mode.
   *(Release builds use the bundled `maverick-sidecar.exe`, so this only affects `tauri dev`.)*
2. **New terminal tab fails** — `CreateProcessW "/bin/bash -l" in cwd "…\Desktop" failed`. The
   terminal-tab path resolves its shell through the Rust `default_shell` command, which falls back
   to `/bin/bash` on every non-macOS OS, including Windows.
3. **No shell choice** — the user wants the editor "+" menu to offer PowerShell, Command Prompt, and
   WSL when creating a new terminal.

## Context already in the tree

- `src/lib/terminal-shell.ts` already models Windows profiles: `ShellKind` (`powershell`/`cmd`/`wsl`),
  `resolveShell(kind, nav)`, `resolveDefaultShell(nav)`, `availableShells(nav)`. Fully unit-tested.
- `src/components/editor/terminal/TerminalLeaf.tsx` (workspace split panes) already spawns via
  `resolveShell(getDefaultShellKind())` + `getGlobalEnv()` — i.e. the frontend is already the source
  of truth for shell resolution there.
- `terminal.defaultShell` is a persisted setting (default `"powershell"`), read imperatively by
  `getDefaultShellKind()`.

Only `src/hooks/useTerminalTab.ts` (the editor terminal **tab**) was never migrated — it still calls
the Rust `default_shell` command and hardcodes `["-l"]`. That is the sole source of the `/bin/bash`
bug.

## Decisions (from brainstorming)

- Picker UI: **three flat items** (PowerShell / Command Prompt / WSL) replacing the single "Terminal"
  item, Windows only. Off-Windows keeps the single "Terminal" item.
- WSL: **detected, single entry** — shown only when WSL is actually installed.
- Bun bug: **fixed** as part of this work.
- Persistence: **none new** — default is the existing `terminal.defaultShell` setting (PowerShell);
  picks are per-terminal and do not change the default.

## Design

### 1. Bun sidecar resolution (Rust, `src-tauri/src/lib.rs`, dev-mode only)

Add a pure, injectable helper:

```
fn resolve_bun(path_var: &str, home: Option<&str>, exists: impl Fn(&Path) -> bool)
    -> (String, Vec<String>)
```

- Searches each `PATH` entry for `bun.exe`, then `bun.cmd`, then `bun.bat`; then `~/.bun/bin/bun.exe`.
- `.exe` → `(full_path, [])` (spawn directly).
- `.cmd` / `.bat` → `("cmd.exe", ["/C", full_path])` — `CreateProcessW` cannot execute batch files
  directly, so they must run through `cmd.exe`.
- Nothing found → `("bun".into(), [])` — preserves today's error path / StatusBar message.

`dev_sidecar_command()` calls `resolve_bun(env PATH, env HOME/USERPROFILE, |p| p.exists())` on
Windows and prepends the resolved program/prefix to `["run", <entry>]`. Non-Windows keeps `"bun"`.
The helper is pure (filesystem injected) → fully unit-testable.

### 2. Remove the `/bin/bash` footgun (Rust + frontend)

- **Delete** the Rust `default_shell` command (`src-tauri/src/commands/shell.rs` body, its `mod.rs`
  export, and the `invoke_handler` entry) and the `defaultShell()` wrapper in `src/lib/tauri.ts`.
  Rationale: `terminal-shell.ts` is already the single source of truth (TerminalLeaf uses it);
  keeping a Rust resolver that emits `/bin/bash` on Windows is dead code and a latent footgun.
- **Rewrite `useTerminalTab.open(cwd, kind?)`** to mirror `TerminalLeaf`:
  `const { shell, args } = resolveShell(kind ?? getDefaultShellKind());`
  then `ptySpawn(shell, args, cwd, getGlobalEnv())`.
  - explicit `kind` (menu pick) wins;
  - otherwise the persisted `terminal.defaultShell` (PowerShell on Windows by default);
  - otherwise the platform default from `resolveDefaultShell`.
  - Shell resolution is now synchronous — the old `default_shell` IPC cache
    (`shellPromise` / `__resetTerminalShellCacheForTests`) is removed.

### 3. WSL detection (Rust, `src-tauri/src/commands/shell.rs`)

New Tauri command `wsl_available() -> bool`:

- Non-Windows → `false`.
- Windows → run `wsl.exe -l -q` with `CREATE_NO_WINDOW`; success **and** non-empty (UTF-16LE-decoded)
  output ⇒ `true`. Spawn error ⇒ `false`.
- Pure helpers `wsl_output_has_distro(success, stdout)` and `decode_utf16le_lossy(bytes)` carry the
  logic and are unit-tested on all platforms; the OS spawn is a thin `#[cfg(windows)]` wrapper.

Exposed via `src/lib/tauri.ts` `wslAvailable(): Promise<boolean>`.

### 4. The "+" menu (frontend, `src/components/editor/EditorTabs.tsx`)

- On mount, compute `availableShells()` (`[]` off-Windows). If it contains `wsl`, call `wslAvailable()`
  and drop `wsl` when false. Store the resulting `ShellKind[]` in component state.
- When the list is non-empty (Windows): render one menu item per kind — PowerShell / Command Prompt /
  WSL — each calling `onNewTerminal(kind)` (testids `editor-tabs-open-terminal-<kind>`).
- When empty (off-Windows): keep today's single "Terminal" item
  (`editor-tabs-open-terminal-tab`, `onNewTerminal()` with no kind).
- `onNewTerminal(kind?)` → `openTerminalTab(await defaultTerminalCwd(), kind)`.
- "New Terminal in Panel" / ⌘⇧T unchanged (default shell, no picker) — out of scope.

## Testing (CLAUDE.md: 100% lines / 95% branches frontend)

- **Rust** (`shell.rs`, `lib.rs`): `resolve_bun` table tests (.exe / .cmd / .bat / none, with &
  without `~/.bun`); `wsl_output_has_distro` (success+distro, success+empty, failure);
  `decode_utf16le_lossy`; `wsl_available` non-Windows ⇒ false.
- **TS**:
  - `useTerminalTab`: each explicit kind → correct `(shell, args, cwd, env)`; no kind → default;
    optimistic add; spawn-failure rollback; close paths (kept).
  - `EditorTabs`: Windows (stubbed nav + mocked `wslAvailable`) renders 3 items / hides WSL when
    undetected; off-Windows renders the single Terminal item; clicking an item spawns with the right
    shell.
  - `tauri.ts`: add `wslAvailable`; remove the `defaultShell` test.
  - `terminal-shell.ts`: already covered.

## Out of scope

- Panel (⌘⇧T) terminal profile picker.
- Enumerating individual WSL distros (single "WSL" entry only).
- Remembering the last-picked shell as the new default.
- macOS/Linux `$SHELL` honoring (the frontend default is `terminal.defaultShell` / `resolveDefaultShell`).
