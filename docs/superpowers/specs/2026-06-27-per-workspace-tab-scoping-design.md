# Per-Workspace Tab Scoping — Design Spec

**Status:** Approved 2026-06-27 — Malhar Ujawane
**Owner:** Frontend (Editor/Terminal agent zone)
**Tracking:** docs/superpowers/plans/2026-06-27-per-workspace-tab-scoping.md (to be written)

## Problem

Today `EditorTabs` renders every tab kind in one flat shared row, and the active-tab
pointers are global. When workspace A is active, the row still shows workspace B's file
and terminal tabs, and clicking one clears `activeWorkspaceId` (four-way mutual
exclusion), yanking the visible workspace out from under the user. There is no notion of
a workspace owning a set of tabs.

## Goal

Each **workspace** (git worktree) owns its own set of tabs:

- N **terminal tabs**, each a claude/shell session that can still split internally via the
  existing `SplitGrid`.
- Its **file tabs**.

The single `EditorTabs` row shows workspace switcher chips plus *only the active
workspace's* terminal and file tabs. Switching workspaces swaps that cluster. System tabs
stay global. `+` adds a new terminal tab to the active workspace.

```
[ WS-A | WS-B | WS-C ]  ‖  [ claude① ][ claude② ][ index.ts ][ + ]  ‖  (system tabs)
   workspace chips             ← scoped to the ACTIVE workspace →        global overlay
```

## Non-Goals (v1)

- Persisting the open-tab layout across app restarts. Worktrees persist in SQLite; the
  open-tabs UI state is ephemeral.
- Per-workspace instances of system views (Browser/Kanban/Git/Skills/Dashboard/Settings).
  These remain app-global.
- Drag-reordering tabs across the workspace-chip / workspace-tab boundary.
- Moving a terminal or file tab from one workspace to another.
- A scratch terminal with no owning workspace (see Decision 1 — removed).

## Decisions (resolved at design time)

1. **Standalone terminal tabs are folded into workspace-scoped terminal tabs.** Every
   terminal belongs to a workspace; the current global standalone-terminal concept (a
   terminal with no worktree) is removed. The `+` button always creates a terminal in the
   active workspace.
2. **Tab state is ephemeral.** Not persisted across app restart.

## Implementation Refinement (2026-06-27, supersedes §1–6 mechanism)

Reading the actual code changed the mechanism (behavior is unchanged). The original
plan to *replace* `activeWorkspaceId`/`activeFileTabId`/`activeTerminalTabId` with a single
`activeTabByWorkspace` map and *re-key* `splitTrees` by tab id is high-risk: `activeWorkspaceId`
has ~40 consumers and `primaryAgentPtyId`, presets, ai-actions, and automation hard-depend on
the `splitTrees[workspace.id]` + `${workspace.id}-N` leaf-id scheme.

Refined approach — **per-workspace terminal groups, primary group id === `workspace.id`:**

- A workspace owns an ordered list of **terminal groups**. Its *first* (primary) group has
  `id === workspace.id`, so `splitTrees[group.id]`, `${group.id}-1` leaves, `primaryAgentPtyId`,
  presets and ai-actions all keep working with zero changes. Extra groups get `term-<uuid>` ids
  and their own `splitTrees[id]` + `${id}-N` leaves.
- New state: `terminalGroups: TerminalGroup[]` and `activeGroupByWorkspace: Record<string,string>`.
  The existing `activeWorkspaceId` / `activeFileTabId` / `activeSystemTab` pointers and their
  four-way exclusivity are **kept unchanged** — no blast-radius migration.
- Tab scoping is derived, not stored: `contextWorkspaceId(s) = activeWorkspaceId ?? fileTab(activeFileTabId)?.workspaceId`.
  `EditorTabs` renders all workspace chips (switchers) + only the context workspace's terminal-group
  tabs and file tabs. This reuses the existing `selectContextWorkspace` fallback logic.
- The global standalone `terminalTabs[]` is removed (the approved fold): `+` now adds a terminal
  group to the context workspace.
- `FileTab` gains `workspaceId`, derived inside `openFileTab` from `worktreePath` so the ~15
  `openFileTab` call sites need no changes.
- The **primary group cannot be closed individually** (no per-tab X when it's the workspace's only
  group, and the primary tab never shows an X); the workspace is closed via its chip. Extra groups
  are closable. This preserves the `${workspace.id}-1` agent-pty contract.

Where this section conflicts with §1–6 below, this section wins.

## Surface Area Summary

1. `src/state/store.ts` — `TerminalTab` gains `workspaceId`; `FileTab` gains `workspaceId`;
   `splitTrees` re-keyed by terminal-tab id; replace global `activeTerminalTabId` /
   `activeFileTabId` with `activeTabByWorkspace: Record<string, string | null>`. Remove the
   four-way mutual exclusion in favor of two axes (workspace + tab-within-workspace) plus a
   global system overlay.
2. `src/components/editor/EditorTabs.tsx` — three clusters: workspace chips (all),
   active-workspace tabs (terminals + files), system cluster + `+`.
3. `src/components/editor/EditorGroup.tsx` + `WorkspaceEditor.tsx` — two-level keep-alive
   (workspace level, then tab level inside each workspace).
4. `src/components/editor/terminal/TerminalView.tsx` — keyed by `terminalTabId`, split tree
   = `splitTrees[tabId]`.
5. `src/components/editor/terminal/leaf-registry.ts` — leaf ids `${workspaceId}-N` →
   `${terminalTabId}-N`; `killWorkspaceLeaves` iterates a workspace's terminal tabs; add
   `killTerminalTabLeaves(tabId)`.
6. `src/hooks/useWorkspace.ts` — workspace creation seeds one terminal tab and sets it
   active; destruction cleans up all owned tabs.

---

## 1. Store Changes (`src/state/store.ts`)

### Types

```ts
export interface TerminalTab {
  id: string;            // "term-<uuid>"
  workspaceId: string;   // NEW — owning workspace
  title: string;         // e.g. "claude ①"; editable later
}                        // split layout lives in splitTrees[id]

export interface FileTab {
  /* …existing fields… */
  workspaceId: string;   // NEW — explicit owner (was inferred from worktreePath)
}
```

`TerminalTab` loses its old direct `cwd` / `ptyId` fields: cwd derives from the owning
workspace's `worktreePath`, and PTYs live per split-leaf in `leafPtyCache` (the primary
leaf is `${tabId}-1`).

### State shape

```ts
// splitTrees: Record<string, SplitNode>  // RE-KEYED: terminalTabId → tree (was workspaceId → tree)

activeTabByWorkspace: Record<string, string | null>;  // workspaceId → active terminal|file tab id
activeWorkspaceId: string | null;                     // which workspace context is shown
activeSystemTab: SystemTabId | null;                  // global overlay; takes precedence when set
```

Removed: global `activeTerminalTabId`, `activeFileTabId`, and the standalone
`terminalTabs[]` semantics of "no workspace". `terminalTabs[]` remains the storage array but
every entry now carries a `workspaceId`.

### Derivation — what is shown

```
visibleContent =
  activeSystemTab != null
    ? systemView(activeSystemTab)                       // global overlay
    : tabContent(activeTabByWorkspace[activeWorkspaceId])  // terminal tab → SplitGrid, or file tab → viewer
```

Two orthogonal axes (**which workspace** + **which tab inside it**) replace the old
four-way exclusivity. Selecting a system tab sets `activeSystemTab`; clicking a workspace
chip or one of its tabs clears `activeSystemTab` and restores that workspace's last-active
tab.

### Actions (new / changed)

- `addTerminalTab(workspaceId)` — pushes a `TerminalTab`, seeds `splitTrees[id]` with a
  single leaf, sets `activeTabByWorkspace[workspaceId] = id`.
- `closeTerminalTab(tabId)` — removes the tab, calls `killTerminalTabLeaves(tabId)`, deletes
  `splitTrees[tabId]`, and if it was active picks the workspace's next tab (or null →
  `EmptyEditor`).
- `setActiveTab(workspaceId, tabId)` — sets `activeTabByWorkspace[workspaceId]`, clears
  `activeSystemTab`.
- `setActiveWorkspace(id)` — sets `activeWorkspaceId`, clears `activeSystemTab`, bumps MRU.
  No longer clears tab pointers (they're per-workspace now).
- `openFileTab(...)` / `closeFileTab(...)` — gain/respect `workspaceId`; closing an active
  file tab falls back to the workspace's next tab.
- `removeWorkspace(id)` — removes all `terminalTabs` and `fileTabs` with that
  `workspaceId`, deletes their `splitTrees`, deletes `activeTabByWorkspace[id]`.

`computeLiveWorkspaceIds(...)` (workspace-level LRU) is unchanged.

## 2. `EditorTabs.tsx`

Render three clusters left-to-right:

1. **Workspace chips** — every workspace, always visible; click → `setActiveWorkspace`.
   Active chip highlighted.
2. **Active-workspace tabs** — `terminalTabs` + `fileTabs` filtered to `activeWorkspaceId`,
   in open order; click → `setActiveTab`; close button per tab. Hidden entirely when a
   system tab is active is *not* required — they remain visible so the user can return; the
   active highlight simply moves to the system tab.
3. **System cluster + `+`** — `+` calls `addTerminalTab(activeWorkspaceId)`; the `+` dropdown
   keeps existing system-view entries.

If there is no active workspace (e.g. none created yet), cluster 2 is empty and `+` is
disabled (or creates a workspace first — match existing empty-state behavior).

## 3. `EditorGroup.tsx` / `WorkspaceEditor.tsx` — two-level keep-alive

Outer level (unchanged mechanism): for each workspace in `computeLiveWorkspaceIds`, mount a
`WorkspaceEditor` container; `display:none` + `content-visibility:auto` when it is not the
active workspace.

Inner level (new): `WorkspaceEditor` owns its workspace's tabs and switches among them:

```
<WorkspaceEditor ws active={ws.id === activeWorkspaceId && activeSystemTab == null}>
  {terminalTabsOf(ws).map(t =>
     <TerminalView tabId={t.id}
        active={activeTabByWorkspace[ws.id] === t.id}   // display:none + visible=false when inactive
     />)}
  {fileTabsOf(ws).map(f =>
     <FileViewer  tab={f}
        active={activeTabByWorkspace[ws.id] === f.id}   // LRU-suspended as today
     />)}
  {ws has no tabs && <EmptyEditor onNewTerminal={() => addTerminalTab(ws.id)} />}
</WorkspaceEditor>
```

Keep-alive invariants preserved: inactive terminal tabs stay mounted (`display:none`) so
PTYs survive, and render with `visible=false` so they release the xterm renderer (existing
`SplitGrid`/`TerminalLeaf` behavior). File tabs keep their existing LRU suspension.

## 4. `TerminalView.tsx`

Currently creates/owns a split tree per `workspace.id`. Change to take a `tabId` prop and
use `splitTrees[tabId]`. The initial leaf is `${tabId}-1`; cwd still resolves to
`workspace.worktreePath`. The launch spec (claude vs shell) continues to come from
`launchSpecs` keyed as it is today; the first terminal tab of a workspace consumes the
workspace's launch spec, subsequent `+` tabs default to the workspace's plain shell (or
re-launch claude — match the existing default-launch behavior; confirm in plan).

## 5. `leaf-registry.ts`

- Leaf id scheme `${workspaceId}-N` → `${terminalTabId}-N`.
- `primaryAgentPtyId(workspaceId)` → resolve via the workspace's first/active terminal tab's
  `${tabId}-1`. Add a `primaryAgentPtyId` overload or a `primaryAgentPtyIdForTab(tabId)`.
- `killWorkspaceLeaves(workspaceId)` → look up the workspace's terminal tab ids and kill each
  tab's leaves.
- Add `killTerminalTabLeaves(tabId)` — prefix scan on `${tabId}-`.

## 6. `useWorkspace.ts`

- `create(...)` — after `addWorkspace(ws)` + `setActiveWorkspace(ws.id)`, call
  `addTerminalTab(ws.id)` so the workspace opens with one session active. Setup-tab queuing
  unchanged.
- `destroy(...)` — relies on the updated `removeWorkspace` to drop owned tabs + leaves;
  verify no dangling `splitTrees` / `activeTabByWorkspace` entries.

## Behaviors / Edge Cases

| Case | Behavior |
|---|---|
| Create workspace | Seeds one terminal tab, set active; shows Setup tab in Panel as today. |
| Switch workspace | Pure CSS toggle (<10ms); restores `activeTabByWorkspace[id]`. |
| `+` in a workspace | New terminal tab in that workspace, becomes active. |
| Close a terminal tab | Kill its leaves; activate next tab; if none, `EmptyEditor`. |
| Close a file tab | Activate workspace's next tab (terminal or file). |
| Select a system tab | `activeSystemTab` set; overlay shown; workspace chips remain to return. |
| Destroy workspace | All owned terminal/file tabs + split trees + leaves removed (fixes current cross-workspace leak). |
| Split inside a terminal tab | Unchanged `SplitGrid`, now keyed under `splitTrees[tabId]`. |

## Testing

Per CLAUDE.md thresholds (100% lines / 95% branches). Vitest + Testing-Library:

- Store: `addTerminalTab` / `closeTerminalTab` / `setActiveTab` / `setActiveWorkspace`
  scoping; `removeWorkspace` cleans owned tabs + split trees; `activeTabByWorkspace`
  fallback on close.
- `EditorTabs`: only active-workspace terminal/file tabs render; chips switch; `+` targets
  active workspace.
- `EditorGroup`/`WorkspaceEditor`: inactive workspace `display:none` and stays mounted;
  inactive terminal tab `display:none` + `visible=false`; PTY survival across switches
  (assert `leafPtyCache` reuse, no respawn).
- `leaf-registry`: leaf-id scheme; `killWorkspaceLeaves` / `killTerminalTabLeaves` kill the
  right PTYs and nothing else.

## Risk / Migration Notes

- The four-way mutual-exclusion removal touches every call site of `setActiveWorkspace` /
  `setActiveSystemTab` / the removed `activeTerminalTabId` / `activeFileTabId`. Grep all
  consumers and migrate to the two-axis model.
- `splitTrees` re-key changes every read/write of that map and the leaf-id scheme — keep the
  change atomic with `leaf-registry`.
- Watch the xterm renderer budget: many terminal tabs across many live workspaces. Mounting
  is bounded by workspace-level LRU; renderer slots are bounded because inactive tabs render
  `visible=false`. No new global terminal LRU in v1; revisit if renderer pressure appears.
