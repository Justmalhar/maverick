# New Workspace UI — Design

*Date: 2026-06-27 · Branch: feature/new-workspace-ui*

## Problem

Creating a workspace today is split across two mutually-exclusive dialogs reached
from two separate project-row action buttons:

- **`NameWorkspaceDialog`** (`Plus` button) — branch-type chips + branch name + "Let AI name it later".
- **`CreateFromDialog`** (`Link2` button) — a command-palette base-branch picker.

You can either name the branch *or* pick a base branch, never both, and the
coding agent is hardcoded to `claude-code` in `ProjectsView.onAddWorkspace`. The
data layer already accepts all three inputs in one call:
`create(projectId, branch, backend, baseBranch)`.

## Goal

One redesigned **New Workspace** dialog that gathers, in a single create call:

1. **Coding agent** (new) — user-selected instead of hardcoded.
2. **Base branch** (folded in from `CreateFromDialog`).
3. **Branch naming** (kept: type chips + name + AI-later).

Out of scope (decided during brainstorming): an initial task-prompt textarea, and
model / reasoning-effort selectors. Maverick launches agents as CLI processes via
a startup command, so neither maps cleanly today.

## Layout

```
┌─────────────────────────────────────────────┐
│  New workspace                            ✕  │
│  Set up an isolated worktree for <project>.  │
│                                              │
│  Coding agent                                │
│  [ ◆ Claude Code                         ▾ ] │  Select, brand icon + label
│                                              │
│  Base branch                                 │
│  [ main                                  ▾ ] │  searchable Popover + Command
│                                              │
│  Branch type                                 │
│  [feature] fix  bug  chore  hotfix           │  chips (kept, restyled)
│                                              │
│  Branch name                                 │
│  [ short description (e.g. login-page)     ] │
│  feature/login-page                          │  live preview
│                                              │
│  ✦ Let AI name it later      [Create workspace]│
└─────────────────────────────────────────────┘
```

## Components & behavior

### Coding agent (new)
- shadcn `Select`, options sourced from `useWorkbench.backends` (installed agents only).
- Default selection: the backend with `active === true`; fallback `claude-code`.
- Each option renders `brandFor(id).Icon` + `brandFor(id).label`.
- Empty state (no installed backends): control disabled, label "No agents detected",
  with a pointer to Settings. Create is still allowed (falls back to `claude-code`)
  so the flow never hard-blocks.

### Base branch (folded in from CreateFromDialog)
- shadcn `Select`, **matching the `TaskComposer` prior art** (project / base-branch /
  agent are all `Select`s there). Avoids adding a new `Popover` primitive.
- Loads via `gitBranchList(projectPath)` (returns `Branch[]` with `isCurrent` /
  `isRemote`), so we can preselect the current branch and tag local/remote items.
- Defaults to the project's **current** branch (`Branch.isCurrent`).
- Optional: if unresolved, `baseBranch` is left `undefined` and the sidecar uses
  its default base.

### Branch type + name + AI-later (kept)
- Logic unchanged: `composeTypedBranch(type, name)` drives the live preview.
- `BRANCH_TYPES = ["feature","fix","bug","chore","hotfix"]`.
- "Create workspace" disabled while the composed branch is empty (blank name).
- "Let AI name it later" creates immediately and marks `markPendingAiRename`.

## Data flow

```
NewWorkspaceDialog
  → onCreate({ backend, baseBranch, branch })          // named branch
  → onAiLater({ backend, baseBranch })                 // defer naming
        ↓ (ProjectsView.onAddWorkspace)
  create(projectId, branch, backend, baseBranch)
  setLaunchSpec(ws.id, resolveStartupLaunch(backend))  // backend now dynamic
  if aiLater: markPendingAiRename(ws.id)
```

The only behavioral change to plumbing: `backend` is the user's selection rather
than the constant `DEFAULT_BACKEND = "claude-code"`. `resolveStartupLaunch` already
takes a backend id.

## Files

**New**
- `src/components/primarysidebar/NewWorkspaceDialog.tsx`
- `src/components/primarysidebar/NewWorkspaceDialog.test.tsx`

**Modified**
- `src/components/primarysidebar/ProjectsView.tsx` — single dialog state
  (`newWorkspaceProjectId`); `onAddWorkspace` accepts/forwards a `backend`;
  remove the now-dead `CreateFromDialog` / `NameWorkspaceDialog` wiring.
- `src/components/primarysidebar/ProjectItem.tsx` — drop the `Link2` "Create from"
  action; keep a single `Plus` "New workspace" action (`onCreateFrom` prop removed).

**Deleted**
- `src/components/primarysidebar/NameWorkspaceDialog.tsx` (+ `.test.tsx`)
- `src/components/primarysidebar/CreateFromDialog.tsx`

**No new primitives needed** — `src/components/ui/select.tsx`, `dialog.tsx`,
`input.tsx` already exist.

**Unchanged shared helpers reused**: `composeTypedBranch` (`lib/branch-name`),
`gitBranchList` (`lib/tauri`), `brandFor` (`lib/backend-brand`),
`resolveStartupLaunch` (`lib/launch`).

## Design-system compliance

- shadcn primitives + Tailwind v4 tokens only (`bg-background`, `text-muted-foreground`,
  `bg-accent`, `rounded-md`, `font-mono`, spacing scale). No hand-rolled values.
- CSS class hook `.mv-newworkspace` if a container class is needed.
- Framer Motion comes free via the shadcn `Dialog`; honor `prefers-reduced-motion`.
- Preserve `data-testid`s for chips/inputs/buttons; add testids for agent + base-branch controls.

## Edge cases

- **No installed agents** → agent select disabled, create falls back to `claude-code`.
- **Default backend not installed** → fall back to first installed, else `claude-code`.
- **Branch list loading / empty** → base-branch control shows a loading/empty state;
  `baseBranch` stays `undefined`.
- **Blank branch name** → "Create workspace" disabled; "Let AI name it later" remains enabled.

## Testing (Vitest + RTL, coverage thresholds enforced)

- Renders with default agent (active backend) and current base branch preselected.
- Changing the agent select changes the `backend` passed to `onCreate`.
- Selecting a base branch passes it through; default is the current branch.
- Branch-type chip + name compose into the correct preview and `onCreate` branch.
- "Let AI name it later" calls `onAiLater` with the selected backend/base, not `onCreate`.
- "Create workspace" disabled when name blank; Enter submits when valid.
- No-installed-agents path: control disabled, create still falls back to `claude-code`.
