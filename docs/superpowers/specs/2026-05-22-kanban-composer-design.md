# Kanban Board — Task Composer Design

**Date:** 2026-05-22  
**Author:** Malhar Ujawane  
**Status:** Approved

---

## 1. Overview

Redesign `KanbanBoard` into a global multi-project board with a Twitter-style **Task Composer** pinned at the top. Sending a task creates a Kanban card in **Todo** and immediately spawns an agent workspace, auto-transitioning the card to **In Progress**.

---

## 2. Data Model Changes

### 2.1 `KanbanTask.status` rename

`"backlog"` → `"todo"`. Full set: `"todo" | "in_progress" | "review" | "done"`.

Updated in:
- `src/lib/ipc.ts` — TypeScript union type
- `sidecar/types.ts` — Bun sidecar mirror
- Rust DB migration #002 (see §2.4)

### 2.2 New fields on `KanbanTask`

```ts
agentBackend: string;       // backend id selected at compose time
branch: string;             // git branch or worktree path
attachments: Attachment[];  // inline, stored as JSON in SQLite
```

### 2.3 New `Attachment` type (`src/lib/ipc.ts`)

```ts
interface Attachment {
  name: string;             // filename shown as chip
  content: string;          // UTF-8 text or base64 binary
  encoding: "utf8" | "base64";
  size: number;             // bytes, display only
}
```

Stored inline on the `kanban_tasks` row as a JSON column. Binary files capped at 2 MB each.

### 2.4 DB migration #002

Rust migration runs at app start before any IPC commands are registered:

```sql
UPDATE kanban_tasks SET status = 'todo' WHERE status = 'backlog';
ALTER TABLE kanban_tasks ADD COLUMN agent_backend TEXT NOT NULL DEFAULT '';
ALTER TABLE kanban_tasks ADD COLUMN branch TEXT NOT NULL DEFAULT '';
ALTER TABLE kanban_tasks ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';
```

Idempotent: guarded by a `schema_migrations` table check.

---

## 3. New Tauri Commands

### 3.1 `git_branches(project_id: String) → Vec<String>`

- Runs `git branch -a --format=%(refname:short)` in the project's path.
- Appends worktree paths via `git worktree list --porcelain` as `worktree/<path>` entries.
- Local branches listed first, then remotes, then worktrees.
- Returns empty vec on error (caller shows retry UI).

### 3.2 `git_diff_stat(workspace_id: String) → DiffStat`

```ts
interface DiffStat {
  added: number;
  removed: number;
}
```

- Runs `git diff --shortstat HEAD` inside the workspace's worktree path.
- Returns `{ added: 0, removed: 0 }` on error.

---

## 4. Component Architecture

### 4.1 Layout

```
KanbanBoard
├── TaskComposer          ← top, always visible
├── ProjectFilterTabs     ← horizontal tab strip, filters cards client-side
└── DragDropContext
    └── columns row
        ├── KanbanColumn (todo)
        ├── KanbanColumn (in_progress)
        ├── KanbanColumn (review)
        └── KanbanColumn (done)
```

### 4.2 `TaskComposer` (`src/panels/kanban/TaskComposer.tsx`)

**Visual structure:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Task Composer                                                  │
│  [textarea: "What needs to be done?"]                           │
│  [attachment chips row]                                         │
│  [Project ▾]  [Branch/Worktree ▾]  [Agent ▾]     [Send →]      │
└─────────────────────────────────────────────────────────────────┘
```

**Textarea:**
- Auto-grows 2–8 rows via `field-sizing: content` + `max-height`.
- `⌘Enter` submits.
- **Paste intercept:** if `event.clipboardData.getData("text").length > 1000` chars, prevent default, create an `Attachment` named `pasted_DDMMYYYYHHMM.txt` (UTC timestamp), add as chip. Under 1000 chars pastes normally.

**Attachment chips:**
- Drag a file onto the composer → chip with filename + human-readable size.
- Binary files base64-encoded client-side via `FileReader`.
- Each chip has `×` dismiss.
- Chips wrap; composer height adjusts.

**Selectors:**
- **Project:** Popover from `store.projects`. Defaults to `activeWorkspace.projectId` if set, otherwise unset.
- **Branch / Worktree:** Disabled until project selected. Fetches via `gitBranches(projectId)` on project change (immediate, no debounce). Loading spinner while fetching. Shows local branches, then remotes, then `worktree/…` entries. Searchable.
- **Agent:** Flat list of `store.backends`. Each backend = one option. Defaults to first active backend.

**Send sequence:**
1. Validate: prompt non-empty AND project + branch + agent selected. Send button disabled otherwise.
2. `kanbanUpsert({ status:"todo", title: prompt.split("\n")[0].slice(0, 80), description: prompt, agentBackend, branch, attachments, projectId, columnOrder: maxColumnOrderInTodoColumn + 1, labels: [], createdAt: Math.floor(Date.now() / 1000) })`
3. `workspaceCreate(projectId, branch, agentBackend)`
4. `kanbanUpsert({ id: task.id, status:"in_progress", workspaceId: workspace.id })`
5. `store.addWorkspace(workspace)` + `store.setActiveWorkspace(workspace.id)`
6. Reset composer fields.

If step 3 fails: task remains in `todo`, inline error shown below Send button, fields preserved for retry.

**Props:**
```ts
interface TaskComposerProps {
  onSend: (payload: ComposerPayload) => Promise<void>;
}

interface ComposerPayload {
  prompt: string;
  projectId: string;
  branch: string;
  agentBackend: string;
  attachments: Attachment[];
}
```

### 4.3 `ProjectFilterTabs` (`src/panels/kanban/ProjectFilterTabs.tsx`)

- Horizontal scrollable tab strip.
- "All projects" tab first, then one tab per `store.projects`.
- When there are more than 5 project tabs, tabs 6 and beyond overflow into a `More ▾` popover (shadcn `DropdownMenu`).
- Selected project ID stored in `KanbanBoard` local state (`filterProjectId: string | null`).
- Filtering is client-side: `tasks.filter(t => !filterProjectId || t.projectId === filterProjectId)`.

### 4.4 `KanbanCard` redesign

```
┌───────────────────────────────────────────────────────┐
│  branch-name  +403 -173                            ◎  │  ← branch + diff stats + agent dot
│  Task title                                           │  ← title (font-medium)
│  Description preview clipped to 2 lines...            │  ← text-muted-foreground
│  [↑ Create PR]                          41m ago       │  ← contextual action + relative time
└───────────────────────────────────────────────────────┘
```

**Branch + diff stats:** shown only when `task.workspaceId` set. `gitDiffStat` called on mount, results cached in `Map<workspaceId, DiffStat>` inside `KanbanBoard` — no re-fetch on re-render. Errors silently hide the row.

**Agent status dot colours:**
- `in_progress` → green (`bg-green-500`)
- `review` → amber (`bg-yellow-500`)
- `todo` / `done` → muted (`bg-muted-foreground`)

**Contextual action button:**
| Status | Button |
|--------|--------|
| `todo` | Start |
| `in_progress` | View |
| `review` | Create PR |
| `done` | — |

**Relative timestamp:** `formatDistanceToNow(task.createdAt * 1000, { addSuffix: true })` via `date-fns`.

### 4.5 `KanbanBoard` changes

- Remove `projectId` guard — board always renders regardless of active workspace.
- `kanbanList("")` fetches tasks for all projects (`""` = no project filter; Tauri command must accept empty string as "all").
- Holds `filterProjectId` state for tab filtering.
- Holds `diffStatCache: Map<string, DiffStat>` passed down to cards.
- `onSend` callback passed to `TaskComposer` orchestrates the 4-step Send sequence.
- Column label map updated: `todo: "Todo"` replaces `backlog: "Backlog"`.

---

## 5. Error Handling

| Failure point | Behaviour |
|---|---|
| `kanbanList` | Full-width error bar + retry button (existing pattern) |
| `gitBranches` | Branch dropdown: "Could not load branches" + retry icon |
| `workspaceCreate` | Task stays in `todo`; inline error below Send button; fields preserved |
| `gitDiffStat` | Diff stat row hidden silently on card |
| Attachment >2MB | Chip rejected with inline error: "File too large (max 2 MB)" |

---

## 6. Testing

### React / Vitest

**`TaskComposer.test.tsx`**
- Paste >1000 chars → chip created, textarea stays empty
- Paste ≤1000 chars → textarea filled normally
- DnD file → chip appears with correct filename and size
- Send disabled when prompt empty
- Send disabled when project not selected
- Send disabled when branch not selected
- Send sequence: mocked `kanbanUpsert` + `workspaceCreate` called in order
- `workspaceCreate` failure → error shown, fields preserved

**`ProjectFilterTabs.test.tsx`**
- "All projects" tab shows all tasks
- Project tab filters to matching `projectId` only
- >5 projects → overflow in More popover

**`KanbanBoard.test.tsx`**
- Board renders without active workspace (no empty state)
- `kanbanList("")` called (not filtered by projectId)

**`KanbanCard.test.tsx`**
- Diff stats row rendered when `workspaceId` present
- Diff stats row hidden when `workspaceId` absent
- Agent dot colour matches status
- Contextual action button per status

### Rust

- `git_branches`: fixture bare repo returns local + worktree entries
- Migration #002: idempotency — running twice produces no error and no duplicate `todo` rows

---

## 7. Files Affected

| File | Change |
|---|---|
| `src/lib/ipc.ts` | Add `Attachment`, `DiffStat`, new `KanbanTask` fields, rename status |
| `sidecar/types.ts` | Mirror `KanbanTask` changes |
| `src/lib/tauri.ts` | Add `gitBranches`, `gitDiffStat` wrappers |
| `src-tauri/src/commands/` | Add `git_branches`, `git_diff_stat` commands |
| `src-tauri/src/db/migrations/` | Add migration #002 |
| `src/panels/kanban/KanbanBoard.tsx` | Global scope, diffStatCache, onSend, tab filter |
| `src/panels/kanban/TaskComposer.tsx` | **New** |
| `src/panels/kanban/ProjectFilterTabs.tsx` | **New** |
| `src/panels/kanban/KanbanCard.tsx` | Branch/diff stats, agent dot, contextual action |
| `src/panels/kanban/KanbanColumn.tsx` | Rename `backlog` → `todo` in LABELS |
| `src/panels/kanban/KanbanTaskDialog.tsx` | Add `agentBackend`, `branch` fields; rename status |
| `**/*.test.*` | Tests for all changed/new components |
