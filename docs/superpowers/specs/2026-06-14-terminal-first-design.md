# Terminal-First Maverick — Design Spec

*Date: 2026-06-14 · Branch: `cc-feature/terminal-first` · Author: Malhar Ujawane (with Claude)*

## Problem

Maverick has two per-workspace editor modes: **Agent Mode** (`AgentTerminal`, which spawns the
backend CLI — `claude`/`codex`/etc. — as the PTY's *root* process) and **Terminal Mode**
(`TerminalView` → `SplitGrid` → `TerminalLeaf`, a real shell with splits). Agent Mode is the default.

Two user-reported bugs both trace to the captive-CLI Agent Mode:

1. **Ctrl-C freezes the pane.** The CLI is PID 1 of the PTY. `Ctrl-C` out of the Claude chat exits
   the root process; there is no shell underneath, so the pane is dead/frozen.
2. **Split (`⌘D`/`⌘⇧D`) does nothing.** Split handling lives only in `TerminalView`, which is
   `hidden` + `visible=false` whenever the workspace is in Agent Mode (the default). The user never
   reaches a live split grid. (Per-leaf PTYs already work correctly in `TerminalLeaf` — split is
   *unreachable*, not *broken*.)

## Goal

Maverick becomes **terminal-first**: a full terminal application with added file viewing, editing,
and version-control capabilities. Every workspace is a real shell PTY. Launching an agent is an
*action* (type its command into the shell), not a *mode*.

Scope is limited to the user-reported items: terminal-first collapse, Ctrl-C fix, split fix, and the
worktree → terminal → CLI → prompt launch flow. Review findings (remote security, dead controls,
leaks, etc.) are explicitly **deferred** to a separate tracked effort.

## Design

### 1. Collapse to terminal-first

- `WorkspaceEditor` renders **only** `TerminalView`. Remove the `hidden={mode !== "agent"}` /
  `hidden={mode !== "terminal"}` dual-render and the `terminalVisible` gating (always visible when
  active).
- Delete `AgentTerminal.tsx` and `AgentTerminal.test.tsx`.
- Remove from `store.ts`: `editorModes`, `setEditorMode`, `toggleEditorMode`, `selectEditorMode`,
  and the `EditorMode` import/usages.
- Remove the mode-toggle command + keybinding from `useShortcuts.ts` and any mode-toggle UI control
  (EditorTabs / StatusBar).
- `killAgentPty` callers migrate to `killWorkspaceLeaves` (already exists in `TerminalLeaf`).

**Result:** the CLI runs as a child of the shell → `Ctrl-C` returns to the shell prompt; splits are
always reachable on a live grid.

### 2. Launch spec (worktree → terminal → CLI → prompt)

Frontend-only. **No IPC / Rust / sidecar type changes** — `pty_write` already exists.

- New store map: `launchSpecs: Record<string, LaunchSpec>` where
  `LaunchSpec = { command: string; args: string[]; env?: Record<string,string>; prompt?: string }`.
  Actions: `setLaunchSpec(workspaceId, spec)` and `consumeLaunchSpec(workspaceId): LaunchSpec | null`
  (returns and deletes — single-shot).
- New hook `useLaunchSpec(workspaceId, ptyId, ready)` (in `src/lib/` / `src/hooks/`):
  1. When the **primary leaf's** shell PTY becomes ready, consume the spec once. A module-level
     `Set<workspaceId>` guard ensures tab-switch / keep-alive remount never re-fires.
  2. `ptyWrite(ptyId, "<command> <args…>\r")` to launch the CLI inside the shell.
  3. If `prompt` is set, run **output-idle detection** on that PTY's `pty:data` stream: reset a
     400ms timer on each chunk; on fire (CLI finished drawing its prompt), bracketed-paste
     `\x1b[200~<prompt>\x1b[201~\r`. Safety cap: paste anyway after 10s. Optional per-CLI
     ready-marker lookup may short-circuit the idle wait.
  4. No prompt → stop after launch (interactive CLI).
- Helper module `terminal-launch.ts`: pure functions for command-line assembly and the bracketed-paste
  wrapper, unit-tested independently of the hook.

Only the **primary** leaf (`${workspace.id}-1`) consumes the spec; subsequently-split leaves are bare
shells.

### 3. Cross-platform shell

`TerminalLeaf` hardcodes `LEAF_SHELL = "/bin/zsh"`, `LEAF_ARGS = ["-l"]`. Since the terminal is now
the only surface, the default shell is load-bearing. Introduce `resolveDefaultShell()` in a small
util:

- macOS / Linux: `/bin/zsh -l` (fall back to `/bin/bash -l`, then `$SHELL`).
- Windows: PowerShell (`powershell.exe`) — args tweaked appropriately; no `-l`.

Detect platform from the Tauri OS plugin if available, else `navigator.userAgent`. This pass wires
the seam and ships the macOS/Linux path correct; the Windows path is best-effort (no Windows CI).

### 4. Preserved features (avoid regressions)

- **Usage estimate** (`~N tok` in StatusBar): recorded deterministically at prompt-paste time
  (we know the exact prompt text) instead of via keystroke-tapping. Manual typing no longer
  contributes an estimate — acceptable.
- **Agent status pill** (running/done/error): the existing `useAgentStatus` reporter re-attaches to
  the auto-launched primary leaf, so kanban's "working" indicator survives. Degrades gracefully if
  no spec was launched.

### 5. Kanban wiring

`KanbanBoard.handleStart` / `onSend`: replace the `maverick:input-append` CustomEvent dispatch with
`setLaunchSpec(ws.id, { command, args, prompt })` at workspace-create time. The command is resolved
from the task's `agentBackend` via the existing backends table (same fallback chain already present).

## Components & boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `store.ts` `launchSpecs` | single-shot spec storage | — |
| `terminal-launch.ts` | pure cmd-line + bracketed-paste assembly; idle-detect logic | — |
| `useLaunchSpec` | orchestrate consume → write → idle-paste on PTY ready | store, terminal-launch, `ptyWrite`, pty data events |
| `resolveDefaultShell()` | platform shell selection | OS detection |
| `TerminalLeaf` | per-leaf shell PTY (existing) + invoke `useLaunchSpec` on primary leaf | resolveDefaultShell, useLaunchSpec |
| `WorkspaceEditor` | render TerminalView only | — |
| `KanbanBoard` | set launch spec on create | store |

## Testing

- `terminal-launch.ts`: pure-function unit tests (cmd assembly, bracketed-paste wrapping, idle-timer
  fires once, ready-marker short-circuit, 10s cap).
- `useLaunchSpec`: consume-once across remount, launch write, prompt paste after idle, no-prompt path.
- `store`: setLaunchSpec / consumeLaunchSpec single-shot; editorModes removal doesn't break consumers.
- `WorkspaceEditor`: renders TerminalView; no AgentTerminal.
- Split reachability: `⌘D` on a freshly-opened workspace produces 2 panes with 2 distinct PTYs.
- `KanbanBoard`: start sets a launch spec with command + prompt.
- Fix the flaky `Workbench.test.tsx` `waitFor` timeout (in blast radius).
- Maintain CI coverage bars (100% lines / 95% branches / 100% functions).

## Out of scope (deferred, tracked separately)

Remote/Companion security P0s (capability gate, hook-server auth, remote path scoping), dead controls
(theme/font persistence, Create-PR button), resource leaks, convertFileSrc media previews, rule-11
PDF static import. These came from the codebase review and are not part of this batch.

## Rollout

Branch `cc-feature/terminal-first` → implement (parallel subagents over non-overlapping zones, shared
contract landed first) → `bun run test:coverage` + `cargo test` + `bun test sidecar/` green →
manual verify in `bun run tauri dev` (open worktree, launch CLI, Ctrl-C back to shell, split) →
merge to `main`.
