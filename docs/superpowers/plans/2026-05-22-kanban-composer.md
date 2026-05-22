# Kanban Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Twitter-style Task Composer to the top of KanbanBoard, with project filter tabs, redesigned cards showing branch/diff stats and contextual actions, and a Send flow that creates a Todo card then immediately spawns an agent workspace.

**Architecture:** The change touches every layer: a new SQLite migration adds `agent_backend`, `branch`, and `attachments` columns and renames `backlog→todo`; the Bun sidecar gains `git.branches` and `git.diffStat` RPC handlers; two new Rust pass-through commands expose them to the frontend; and four new/redesigned React components (`TaskComposer`, `ProjectFilterTabs`, redesigned `KanbanCard`, updated `KanbanBoard`) wire it all together.

**Tech Stack:** Bun (sidecar), Rust/Tauri v2, React 18, Vitest + @testing-library/react, @hello-pangea/dnd, shadcn/ui (Select, DropdownMenu), Framer Motion, date-fns.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `sidecar/migrations/004_kanban_composer.sql` | DB schema changes |
| Modify | `sidecar/types.ts` | Add Attachment, DiffStat; update KanbanTask |
| Modify | `sidecar/kanban-store.ts` | New fields, empty-projectId list, backlog→todo default |
| Modify | `sidecar/kanban-store.test.ts` | Test new fields + list("") |
| Modify | `sidecar/git-module.ts` | Add branches(), diffStat(), static parsers |
| Modify | `sidecar/git-module.test.ts` | Test new methods + parsers |
| Modify | `sidecar/rpc-handlers.ts` | Add git.branches, git.diffStat schemas + cases |
| Modify | `sidecar/rpc-handlers.test.ts` | Test new dispatch paths |
| Modify | `src-tauri/src/commands/git.rs` | git_branches, git_diff_stat Tauri commands |
| Modify | `src-tauri/src/commands/mod.rs` | Export new commands |
| Modify | `src-tauri/src/lib.rs` | Register in invoke_handler |
| Modify | `src/lib/ipc.ts` | Attachment, DiffStat types; KanbanTask new fields; status rename |
| Modify | `src/lib/tauri.ts` | gitBranches, gitDiffStat wrappers |
| Modify | `src/test/fixtures.ts` | makeKanbanTask default status→"todo", add new fields |
| Create | `src/panels/kanban/ProjectFilterTabs.tsx` | Horizontal project filter tab strip |
| Create | `src/panels/kanban/ProjectFilterTabs.test.tsx` | Tests |
| Create | `src/panels/kanban/TaskComposer.tsx` | Composer UI component (exports ComposerPayload) |
| Create | `src/panels/kanban/TaskComposer.test.tsx` | Tests |
| Modify | `src/panels/kanban/KanbanCard.tsx` | Branch row, diff stats, agent dot, contextual action |
| Modify | `src/panels/kanban/KanbanCard.test.tsx` | Tests for new card behaviour |
| Modify | `src/panels/kanban/KanbanColumn.tsx` | Accept diffStatCache prop; rename backlog→todo label |
| Modify | `src/panels/kanban/KanbanColumn.test.tsx` | Pass diffStatCache in tests |
| Modify | `src/panels/kanban/KanbanTaskDialog.tsx` | Rename status; add agentBackend/branch fields |
| Modify | `src/panels/kanban/KanbanTaskDialog.test.tsx` | Update status references |
| Modify | `src/panels/kanban/KanbanBoard.tsx` | Global list, composer, filter tabs, diffStatCache |
| Modify | `src/panels/kanban/KanbanBoard.test.tsx` | Remove project guard; add composer + filter tests |

---

## Task 1: DB Migration

**Files:**
- Create: `sidecar/migrations/004_kanban_composer.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 004_kanban_composer.sql
ALTER TABLE kanban_tasks ADD COLUMN agent_backend TEXT NOT NULL DEFAULT '';
ALTER TABLE kanban_tasks ADD COLUMN branch        TEXT NOT NULL DEFAULT '';
ALTER TABLE kanban_tasks ADD COLUMN attachments   TEXT NOT NULL DEFAULT '[]';
UPDATE kanban_tasks SET status = 'todo' WHERE status = 'backlog';
```

- [ ] **Step 2: Verify migration runs cleanly**

```bash
cd sidecar && bun test sqlite-store.test.ts
```

Expected: all existing SQLiteStore tests pass (migration runner picks up file automatically via `readdirSync`).

- [ ] **Step 3: Commit**

```bash
git add sidecar/migrations/004_kanban_composer.sql
git commit -m "feat(db): migration 004 – add agent_backend/branch/attachments; rename backlog→todo"
```

---

## Task 2: Sidecar Types + KanbanStore

**Files:**
- Modify: `sidecar/types.ts`
- Modify: `sidecar/kanban-store.ts`
- Modify: `sidecar/kanban-store.test.ts`

- [ ] **Step 1: Update `sidecar/types.ts`**

Find the `KanbanTask` interface and replace it with:

```ts
export interface Attachment {
  name: string;
  content: string;
  encoding: "utf8" | "base64";
  size: number;
}

export interface DiffStat {
  added: number;
  removed: number;
}

export interface KanbanTask {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: "todo" | "in_progress" | "review" | "done";
  columnOrder: number;
  workspaceId?: string;
  labels: string[];
  dueDate?: number;
  createdAt: number;
  agentBackend: string;
  branch: string;
  attachments: Attachment[];
}
```

- [ ] **Step 2: Fix existing test in `sidecar/kanban-store.test.ts`**

Find and update this existing assertion (the default status changes from `"backlog"` to `"todo"`):

```ts
// OLD — change this line:
expect(t.status).toBe("backlog");
// NEW:
expect(t.status).toBe("todo");
```

- [ ] **Step 3: Write new failing tests in `sidecar/kanban-store.test.ts`**

Add at the bottom of the existing test file:

```ts
test("upsert stores and retrieves agentBackend, branch, attachments", () => {
  const t = env.kanban.upsert({
    projectId: env.proj.id,
    title: "feat",
    agentBackend: "claude",
    branch: "main",
    attachments: [{ name: "f.txt", content: "hello", encoding: "utf8", size: 5 }],
  });
  expect(t.agentBackend).toBe("claude");
  expect(t.branch).toBe("main");
  expect(t.attachments).toEqual([{ name: "f.txt", content: "hello", encoding: "utf8", size: 5 }]);
});

test("default status is 'todo' not 'backlog'", () => {
  const t = env.kanban.upsert({ projectId: env.proj.id, title: "x" });
  expect(t.status).toBe("todo");
});

test("list('') returns tasks from all projects", () => {
  const proj2 = env.store.projectAdd({ path: "/tmp/other" });
  env.kanban.upsert({ projectId: env.proj.id, title: "p1-task" });
  env.kanban.upsert({ projectId: proj2.id, title: "p2-task" });
  const all = env.kanban.list("");
  expect(all.length).toBe(2);
});

test("list(projectId) filters correctly", () => {
  const proj2 = env.store.projectAdd({ path: "/tmp/p2" });
  env.kanban.upsert({ projectId: env.proj.id, title: "mine" });
  env.kanban.upsert({ projectId: proj2.id, title: "theirs" });
  const mine = env.kanban.list(env.proj.id);
  expect(mine.every(t => t.projectId === env.proj.id)).toBe(true);
  expect(mine.length).toBe(1);
});
```

- [ ] **Step 4: Run tests to verify new tests fail**

```bash
cd sidecar && bun test kanban-store.test.ts
```

Expected: 4 new tests fail with column-not-found or type errors.

- [ ] **Step 5: Update `sidecar/kanban-store.ts`**

Replace the entire file with:

```ts
import { defaultIds } from "./deps";
import type { IdProvider, KanbanTask, Attachment } from "./types";
import type { SQLiteStore } from "./sqlite-store";

interface KanbanRow {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  column_order: number;
  workspace_id: string | null;
  labels_json: string;
  due_date: number | null;
  created_at: number;
  agent_backend: string;
  branch: string;
  attachments: string;
}

export interface KanbanStoreOptions {
  ids?: IdProvider;
}

export class KanbanStore {
  private ids: IdProvider;

  constructor(private store: SQLiteStore, opts: KanbanStoreOptions = {}) {
    this.ids = opts.ids ?? defaultIds;
  }

  list(projectId: string): KanbanTask[] {
    if (projectId === "") {
      const rows = this.store.db
        .query<KanbanRow, []>(
          "SELECT * FROM kanban_tasks ORDER BY status ASC, column_order ASC"
        )
        .all();
      return rows.map(KanbanStore.fromRow);
    }
    const rows = this.store.db
      .query<KanbanRow, [string]>(
        "SELECT * FROM kanban_tasks WHERE project_id = ? ORDER BY status ASC, column_order ASC"
      )
      .all(projectId);
    return rows.map(KanbanStore.fromRow);
  }

  upsert(task: Partial<KanbanTask> & { projectId: string; title: string }): KanbanTask {
    const id = task.id ?? this.ids.uuid("task");
    const status = task.status ?? "todo";
    const columnOrder = task.columnOrder ?? 0;
    const labels = JSON.stringify(task.labels ?? []);
    const attachments = JSON.stringify(task.attachments ?? []);
    const createdAt = task.createdAt ?? Math.floor(this.ids.now() / 1000);
    const agentBackend = task.agentBackend ?? "";
    const branch = task.branch ?? "";

    this.store.db
      .query(
        `INSERT INTO kanban_tasks
           (id, project_id, title, description, status, column_order, workspace_id,
            labels_json, due_date, created_at, agent_backend, branch, attachments)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           project_id    = excluded.project_id,
           title         = excluded.title,
           description   = excluded.description,
           status        = excluded.status,
           column_order  = excluded.column_order,
           workspace_id  = excluded.workspace_id,
           labels_json   = excluded.labels_json,
           due_date      = excluded.due_date,
           agent_backend = excluded.agent_backend,
           branch        = excluded.branch,
           attachments   = excluded.attachments`
      )
      .run(
        id, task.projectId, task.title, task.description ?? null,
        status, columnOrder, task.workspaceId ?? null,
        labels, task.dueDate ?? null, createdAt,
        agentBackend, branch, attachments
      );

    return {
      id,
      projectId: task.projectId,
      title: task.title,
      description: task.description,
      status: status as KanbanTask["status"],
      columnOrder,
      workspaceId: task.workspaceId,
      labels: task.labels ?? [],
      dueDate: task.dueDate,
      createdAt,
      agentBackend,
      branch,
      attachments: task.attachments ?? [],
    };
  }

  delete(id: string): { ok: true } {
    this.store.db.query("DELETE FROM kanban_tasks WHERE id = ?").run(id);
    return { ok: true };
  }

  static fromRow(row: KanbanRow): KanbanTask {
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description ?? undefined,
      status: row.status as KanbanTask["status"],
      columnOrder: row.column_order,
      workspaceId: row.workspace_id ?? undefined,
      labels: JSON.parse(row.labels_json) as string[],
      dueDate: row.due_date ?? undefined,
      createdAt: row.created_at,
      agentBackend: row.agent_backend,
      branch: row.branch,
      attachments: JSON.parse(row.attachments) as Attachment[],
    };
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd sidecar && bun test kanban-store.test.ts
```

Expected: all tests pass including the 4 new ones.

- [ ] **Step 7: Commit**

```bash
git add sidecar/types.ts sidecar/kanban-store.ts sidecar/kanban-store.test.ts
git commit -m "feat(sidecar): KanbanTask new fields, list('') global, backlog→todo default"
```

---

## Task 3: Sidecar GitModule Extensions

**Files:**
- Modify: `sidecar/git-module.ts`
- Modify: `sidecar/git-module.test.ts`

- [ ] **Step 1: Write failing tests in `sidecar/git-module.test.ts`**

Add after the existing `parseStashList` tests:

```ts
describe("GitModule.parseWorktreePaths", () => {
  test("extracts worktree paths, skips non-worktree lines", () => {
    const output = [
      "worktree /home/user/project",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /home/user/project/.maverick/worktrees/ws-1",
      "HEAD def456",
      "branch refs/heads/feat/foo",
    ].join("\n");
    expect(GitModule.parseWorktreePaths(output)).toEqual([
      "/home/user/project",
      "/home/user/project/.maverick/worktrees/ws-1",
    ]);
  });

  test("returns empty array for empty output", () => {
    expect(GitModule.parseWorktreePaths("")).toEqual([]);
  });
});

describe("GitModule.parseDiffStat", () => {
  test("parses insertions and deletions", () => {
    expect(GitModule.parseDiffStat(" 3 files changed, 10 insertions(+), 4 deletions(-)")).toEqual({
      added: 10,
      removed: 4,
    });
  });

  test("returns zeros when no changes", () => {
    expect(GitModule.parseDiffStat("")).toEqual({ added: 0, removed: 0 });
  });

  test("handles insertions-only", () => {
    expect(GitModule.parseDiffStat(" 1 file changed, 5 insertions(+)")).toEqual({
      added: 5,
      removed: 0,
    });
  });
});

describe("GitModule.branches", () => {
  test("returns local branches + worktree entries, skips main worktree", async () => {
    const { shell } = transcript([
      { stdout: "main\nfeat/foo\n" },
      {
        stdout: [
          "worktree /home/user/project",
          "",
          "worktree /home/user/project/.maverick/worktrees/ws-1",
          "",
        ].join("\n"),
      },
    ]);
    const git = new GitModule({ shell });
    const result = await git.branches({ projectPath: "/home/user/project" });
    expect(result).toEqual([
      "main",
      "feat/foo",
      "worktree//home/user/project/.maverick/worktrees/ws-1",
    ]);
  });

  test("returns only local branches when worktree list fails", async () => {
    const calls: string[][] = [];
    const shell: Shell = {
      async text(cmd) {
        calls.push(cmd);
        if (cmd.includes("worktree")) throw new Error("no worktrees");
        return "main\n";
      },
      async run(cmd) {
        calls.push(cmd);
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    };
    const git = new GitModule({ shell });
    const result = await git.branches({ projectPath: "/p" });
    expect(result).toEqual(["main"]);
  });
});

describe("GitModule.diffStat", () => {
  test("returns parsed diff stat", async () => {
    const { shell } = transcript([
      { stdout: " 2 files changed, 7 insertions(+), 1 deletion(-)" },
    ]);
    const git = new GitModule({ shell });
    const stat = await git.diffStat({ worktreePath: "/wt" });
    expect(stat).toEqual({ added: 7, removed: 1 });
  });

  test("returns zeros on shell error", async () => {
    const shell: Shell = {
      async text() { throw new Error("not a git repo"); },
      async run() { return { stdout: "", stderr: "", exitCode: 1 }; },
    };
    const git = new GitModule({ shell });
    const stat = await git.diffStat({ worktreePath: "/bad" });
    expect(stat).toEqual({ added: 0, removed: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd sidecar && bun test git-module.test.ts
```

Expected: new tests fail with "is not a function" errors.

- [ ] **Step 3: Add methods to `sidecar/git-module.ts`**

Add the following import at the top of the file (after existing imports):

```ts
import type { DiffStat } from "./types";
```

Then add these methods inside the `GitModule` class (before the closing brace), and add the two static helpers at the end of the static section:

```ts
  async branches(params: { projectPath: string }): Promise<string[]> {
    const localOut = await this.shell.text(
      ["git", "-C", params.projectPath, "branch", "--list", "--format=%(refname:short)"],
      undefined
    );
    const local = localOut.split("\n").map((l) => l.trim()).filter(Boolean);

    let worktrees: string[] = [];
    try {
      const wtOut = await this.shell.text(
        ["git", "-C", params.projectPath, "worktree", "list", "--porcelain"],
        undefined
      );
      worktrees = GitModule.parseWorktreePaths(wtOut)
        .slice(1)
        .map((p) => `worktree/${p}`);
    } catch {
      // worktrees optional
    }

    return [...local, ...worktrees];
  }

  async diffStat(params: { worktreePath: string }): Promise<DiffStat> {
    try {
      const output = await this.shell.text(
        ["git", "-C", params.worktreePath, "diff", "--shortstat", "HEAD"],
        undefined
      );
      return GitModule.parseDiffStat(output);
    } catch {
      return { added: 0, removed: 0 };
    }
  }

  static parseWorktreePaths(output: string): string[] {
    const paths: string[] = [];
    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        paths.push(line.slice("worktree ".length).trim());
      }
    }
    return paths;
  }

  static parseDiffStat(output: string): DiffStat {
    const added = parseInt(output.match(/(\d+) insertion/)?.[1] ?? "0", 10);
    const removed = parseInt(output.match(/(\d+) deletion/)?.[1] ?? "0", 10);
    return { added, removed };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd sidecar && bun test git-module.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add sidecar/git-module.ts sidecar/git-module.test.ts
git commit -m "feat(sidecar): add GitModule.branches, diffStat, parseWorktreePaths, parseDiffStat"
```

---

## Task 4: Sidecar RPC Handlers

**Files:**
- Modify: `sidecar/rpc-handlers.ts`
- Modify: `sidecar/rpc-handlers.test.ts`

- [ ] **Step 1: Write failing tests in `sidecar/rpc-handlers.test.ts`**

Add after the existing `git.log/stash_list/commit` test:

```ts
test("git.branches dispatches to git module", async () => {
  const proj = (await h.dispatch("project.add", { path: "/tmp/b" })) as { id: string };
  const result = await h.dispatch("git.branches", { projectPath: "/tmp/b" });
  expect(Array.isArray(result)).toBe(true);
});

test("git.diffStat dispatches to git module", async () => {
  const result = await h.dispatch("git.diffStat", { worktreePath: "/wt" });
  expect(result).toHaveProperty("added");
  expect(result).toHaveProperty("removed");
});

test("kanban.list with empty projectId returns all tasks", async () => {
  const p1 = (await h.dispatch("project.add", { path: "/tmp/p1" })) as { id: string };
  const p2 = (await h.dispatch("project.add", { path: "/tmp/p2" })) as { id: string };
  await h.dispatch("kanban.upsert", { task: { projectId: p1.id, title: "t1" } });
  await h.dispatch("kanban.upsert", { task: { projectId: p2.id, title: "t2" } });
  const all = (await h.dispatch("kanban.list", { projectId: "" })) as KanbanTask[];
  expect(all.length).toBe(2);
});
```

Add the `KanbanTask` import at the top of `rpc-handlers.test.ts`:

```ts
import type { KanbanTask } from "./types";
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd sidecar && bun test rpc-handlers.test.ts
```

Expected: 3 new tests fail with "unknown method" or type errors.

- [ ] **Step 3: Add schemas to `sidecar/rpc-handlers.ts`**

In the `Schemas` object, add after the `gitCommit` entry:

```ts
  gitBranches: z.object({ projectPath: z.string() }),
  gitDiffStat: z.object({ worktreePath: z.string() }),
```

- [ ] **Step 4: Add dispatch cases to `sidecar/rpc-handlers.ts`**

In the `handle` method (the big `switch` statement), add after `case "git.commit":`:

```ts
      case "git.branches": {
        const p = Schemas.gitBranches.parse(params);
        return this.git.branches({ projectPath: p.projectPath });
      }
      case "git.diffStat": {
        const p = Schemas.gitDiffStat.parse(params);
        return this.git.diffStat({ worktreePath: p.worktreePath });
      }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd sidecar && bun test rpc-handlers.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add sidecar/rpc-handlers.ts sidecar/rpc-handlers.test.ts
git commit -m "feat(sidecar): add git.branches and git.diffStat RPC handlers"
```

---

## Task 5: Rust Commands + TS IPC Layer

**Files:**
- Modify: `src-tauri/src/commands/git.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/ipc.ts`
- Modify: `src/lib/tauri.ts`
- Modify: `src/test/fixtures.ts`

- [ ] **Step 1: Add Rust commands to `src-tauri/src/commands/git.rs`**

Append at the end of the file:

```rust
#[tauri::command]
pub async fn git_branches(
    state: State<'_, AppState>,
    project_path: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request("git.branches", json!({ "projectPath": project_path }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_diff_stat(
    state: State<'_, AppState>,
    worktree_path: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request("git.diffStat", json!({ "worktreePath": worktree_path }))
        .await
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Export new commands in `src-tauri/src/commands/mod.rs`**

Add to the existing `pub use git::` line:

```rust
pub use git::{git_branches, git_commit, git_diff_stat, git_log, git_stash_list};
```

- [ ] **Step 3: Register in `src-tauri/src/lib.rs`**

In the `invoke_handler!` macro, add after `git_commit,`:

```rust
            git_branches,
            git_diff_stat,
```

- [ ] **Step 4: Verify Rust compiles**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: no errors.

- [ ] **Step 5: Update `src/lib/ipc.ts`**

Replace the `KanbanTask` interface and add new types. Find the `KanbanTask` block and replace:

```ts
export interface Attachment {
  name: string;
  content: string;
  encoding: "utf8" | "base64";
  size: number;
}

export interface DiffStat {
  added: number;
  removed: number;
}

export interface KanbanTask {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: "todo" | "in_progress" | "review" | "done";
  columnOrder: number;
  workspaceId?: string;
  labels: string[];
  dueDate?: number;
  createdAt: number;
  agentBackend: string;
  branch: string;
  attachments: Attachment[];
}
```

- [ ] **Step 6: Add wrappers to `src/lib/tauri.ts`**

Append before the event subscriptions section:

```ts
export async function gitBranches(projectPath: string): Promise<string[]> {
  return invoke("git_branches", { projectPath });
}

export async function gitDiffStat(worktreePath: string): Promise<DiffStat> {
  return invoke("git_diff_stat", { worktreePath });
}
```

Add `DiffStat` to the imports at the top of `tauri.ts`:

```ts
import type {
  // ... existing imports ...
  DiffStat,
} from "./ipc";
```

- [ ] **Step 7: Update `src/test/fixtures.ts`**

Update `makeKanbanTask` to include the new fields and default status:

```ts
export function makeKanbanTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: "task-1",
    projectId: "proj-1",
    title: "Do the thing",
    description: "details",
    status: "todo",
    columnOrder: 0,
    labels: [],
    createdAt: 1700000000,
    agentBackend: "claude",
    branch: "main",
    attachments: [],
    ...overrides,
  };
}
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
bun run build 2>&1 | head -30
```

Expected: no TypeScript errors related to KanbanTask or DiffStat.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/commands/git.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src/lib/ipc.ts src/lib/tauri.ts src/test/fixtures.ts
git commit -m "feat: Rust git_branches/git_diff_stat commands; TS ipc types + fixtures update"
```

---

## Task 6: ProjectFilterTabs Component

**Files:**
- Create: `src/panels/kanban/ProjectFilterTabs.tsx`
- Create: `src/panels/kanban/ProjectFilterTabs.test.tsx`

- [ ] **Step 1: Write failing tests in `src/panels/kanban/ProjectFilterTabs.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { useWorkbench } from "@/state/store";
import { makeProject } from "@/test/fixtures";
import ProjectFilterTabs from "./ProjectFilterTabs";

const initial = useWorkbench.getState();

describe("ProjectFilterTabs", () => {
  it("renders All projects tab and one tab per project", () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", name: "Alpha" }), makeProject({ id: "p2", name: "Beta" })],
    });
    renderWithProviders(<ProjectFilterTabs filterProjectId={null} onFilterChange={vi.fn()} />);
    expect(screen.getByTestId("filter-all")).toBeInTheDocument();
    expect(screen.getByTestId("filter-project-p1")).toBeInTheDocument();
    expect(screen.getByTestId("filter-project-p2")).toBeInTheDocument();
  });

  it("calls onFilterChange(null) when All projects clicked", async () => {
    useWorkbench.setState({ ...initial, projects: [makeProject({ id: "p1", name: "A" })] });
    const onChange = vi.fn();
    renderWithProviders(<ProjectFilterTabs filterProjectId="p1" onFilterChange={onChange} />);
    await userEvent.click(screen.getByTestId("filter-all"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("calls onFilterChange with project id when tab clicked", async () => {
    useWorkbench.setState({ ...initial, projects: [makeProject({ id: "p1", name: "A" })] });
    const onChange = vi.fn();
    renderWithProviders(<ProjectFilterTabs filterProjectId={null} onFilterChange={onChange} />);
    await userEvent.click(screen.getByTestId("filter-project-p1"));
    expect(onChange).toHaveBeenCalledWith("p1");
  });

  it("overflow projects appear in More menu after 5", () => {
    const projects = Array.from({ length: 7 }, (_, i) =>
      makeProject({ id: `p${i}`, name: `P${i}` })
    );
    useWorkbench.setState({ ...initial, projects });
    renderWithProviders(<ProjectFilterTabs filterProjectId={null} onFilterChange={vi.fn()} />);
    expect(screen.getByTestId("filter-more")).toBeInTheDocument();
    expect(screen.queryByTestId("filter-project-p5")).not.toBeInTheDocument();
    expect(screen.queryByTestId("filter-project-p6")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun run test -- src/panels/kanban/ProjectFilterTabs.test.tsx
```

Expected: fail with module not found.

- [ ] **Step 3: Create `src/panels/kanban/ProjectFilterTabs.tsx`**

```tsx
import { useWorkbench } from "@/state/store";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";

const MAX_VISIBLE = 5;

interface Props {
  filterProjectId: string | null;
  onFilterChange: (id: string | null) => void;
}

export default function ProjectFilterTabs({ filterProjectId, onFilterChange }: Props) {
  const projects = useWorkbench((s) => s.projects);
  const visible = projects.slice(0, MAX_VISIBLE);
  const overflow = projects.slice(MAX_VISIBLE);

  const tabClass = (active: boolean) =>
    cn(
      "px-3 py-1.5 text-[11px] whitespace-nowrap border-b-2 transition-colors",
      active
        ? "border-primary text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground"
    );

  return (
    <div
      data-testid="project-filter-tabs"
      className="flex items-center overflow-x-auto border-b border-border"
    >
      <button
        type="button"
        data-testid="filter-all"
        onClick={() => onFilterChange(null)}
        className={tabClass(filterProjectId === null)}
      >
        All projects
      </button>
      {visible.map((p) => (
        <button
          key={p.id}
          type="button"
          data-testid={`filter-project-${p.id}`}
          onClick={() => onFilterChange(p.id)}
          className={tabClass(filterProjectId === p.id)}
        >
          {p.name}
        </button>
      ))}
      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              data-testid="filter-more"
            >
              More <ChevronDown className="ml-1 h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {overflow.map((p) => (
              <DropdownMenuItem
                key={p.id}
                onClick={() => onFilterChange(p.id)}
                data-testid={`filter-overflow-${p.id}`}
                className={cn("text-[11px]", filterProjectId === p.id && "text-primary")}
              >
                {p.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run test -- src/panels/kanban/ProjectFilterTabs.test.tsx
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/panels/kanban/ProjectFilterTabs.tsx src/panels/kanban/ProjectFilterTabs.test.tsx
git commit -m "feat(kanban): ProjectFilterTabs with All/project tabs and More overflow"
```

---

## Task 7: TaskComposer Component

**Files:**
- Create: `src/panels/kanban/TaskComposer.tsx`
- Create: `src/panels/kanban/TaskComposer.test.tsx`

- [ ] **Step 1: Write failing tests in `src/panels/kanban/TaskComposer.test.tsx`**

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { useWorkbench } from "@/state/store";
import { makeBackend, makeProject } from "@/test/fixtures";
import TaskComposer from "./TaskComposer";

const initial = useWorkbench.getState();

function setup() {
  useWorkbench.setState({
    ...initial,
    projects: [makeProject({ id: "p1", name: "Alpha", path: "/alpha" })],
    backends: [makeBackend({ id: "claude", name: "Claude", active: true })],
  });
  const onSend = vi.fn().mockResolvedValue(undefined);
  renderWithProviders(<TaskComposer onSend={onSend} />);
  return { onSend };
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState(initial);
});

describe("TaskComposer", () => {
  it("renders composer heading and textarea", () => {
    setup();
    expect(screen.getByTestId("task-composer")).toBeInTheDocument();
    expect(screen.getByTestId("composer-prompt")).toBeInTheDocument();
  });

  it("Send is disabled when prompt is empty", () => {
    setup();
    expect(screen.getByTestId("composer-send")).toBeDisabled();
  });

  it("Send is disabled when project not selected", async () => {
    setup();
    await userEvent.type(screen.getByTestId("composer-prompt"), "do something");
    expect(screen.getByTestId("composer-send")).toBeDisabled();
  });

  it("paste under 1000 chars fills textarea normally", async () => {
    setup();
    const textarea = screen.getByTestId("composer-prompt");
    await userEvent.click(textarea);
    await userEvent.paste("short text");
    expect((textarea as HTMLTextAreaElement).value).toBe("short text");
    expect(screen.queryByTestId("composer-attachment")).not.toBeInTheDocument();
  });

  it("paste over 1000 chars creates a txt attachment and clears textarea", async () => {
    setup();
    const longText = "x".repeat(1001);
    const textarea = screen.getByTestId("composer-prompt");
    await userEvent.click(textarea);
    await userEvent.paste(longText);
    expect((textarea as HTMLTextAreaElement).value).toBe("");
    const chip = screen.getByTestId("composer-attachment");
    expect(chip.textContent).toMatch(/pasted_.*\.txt/);
  });

  it("attachment chip can be dismissed", async () => {
    setup();
    const longText = "y".repeat(1001);
    await userEvent.paste(screen.getByTestId("composer-prompt"), longText);
    await waitFor(() => expect(screen.getByTestId("composer-attachment")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("composer-remove-attachment"));
    expect(screen.queryByTestId("composer-attachment")).not.toBeInTheDocument();
  });

  it("gitBranches called when project selected", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(["main", "dev"] as never);
    setup();
    const projectTrigger = screen.getByTestId("composer-project");
    await userEvent.click(projectTrigger);
    const alphaOption = await screen.findByText("Alpha");
    await userEvent.click(alphaOption);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("git_branches", { projectPath: "/alpha" }));
  });

  it("onSend called with correct payload and composer resets", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(["main"] as never);
    const { onSend } = setup();

    // Select project
    await userEvent.click(screen.getByTestId("composer-project"));
    await userEvent.click(await screen.findByText("Alpha"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("git_branches", expect.any(Object)));

    // Select branch
    await userEvent.click(screen.getByTestId("composer-branch"));
    await userEvent.click(await screen.findByText("main"));

    // Type prompt (⌘Enter also accepted)
    await userEvent.type(screen.getByTestId("composer-prompt"), "fix the bug");

    // Send button should now be enabled
    await waitFor(() => expect(screen.getByTestId("composer-send")).not.toBeDisabled());
    await userEvent.click(screen.getByTestId("composer-send"));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "fix the bug",
        projectId: "p1",
        branch: "main",
        agentBackend: "claude",
      })
    ));
    expect((screen.getByTestId("composer-prompt") as HTMLTextAreaElement).value).toBe("");
  });

  it("onSend failure shows inline error and preserves fields", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(["main"] as never);
    const { onSend } = setup();
    onSend.mockRejectedValueOnce(new Error("workspace failed"));

    await userEvent.click(screen.getByTestId("composer-project"));
    await userEvent.click(await screen.findByText("Alpha"));
    await waitFor(() => expect(invoke).toHaveBeenCalled());

    await userEvent.click(screen.getByTestId("composer-branch"));
    await userEvent.click(await screen.findByText("main"));

    await userEvent.type(screen.getByTestId("composer-prompt"), "do work");
    await waitFor(() => expect(screen.getByTestId("composer-send")).not.toBeDisabled());
    await userEvent.click(screen.getByTestId("composer-send"));

    await waitFor(() => expect(screen.getByTestId("composer-error")).toBeInTheDocument());
    expect((screen.getByTestId("composer-prompt") as HTMLTextAreaElement).value).toBe("do work");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun run test -- src/panels/kanban/TaskComposer.test.tsx
```

Expected: fail with module not found.

- [ ] **Step 3: Create `src/panels/kanban/TaskComposer.tsx`**

```tsx
import { useState, useCallback } from "react";
import { format } from "date-fns";
import { Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkbench } from "@/state/store";
import { gitBranches } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/lib/ipc";

export interface ComposerPayload {
  prompt: string;
  projectId: string;
  branch: string;
  agentBackend: string;
  attachments: Attachment[];
}

interface Props {
  onSend: (payload: ComposerPayload) => Promise<void>;
}

export default function TaskComposer({ onSend }: Props) {
  const projects = useWorkbench((s) => s.projects);
  const backends = useWorkbench((s) => s.backends);
  const activeWorkspace = useWorkbench((s) =>
    s.workspaces.find((w) => w.id === s.activeWorkspaceId)
  );

  const [prompt, setPrompt] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState(
    activeWorkspace?.projectId ?? ""
  );
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [selectedBackendId, setSelectedBackendId] = useState(
    backends.find((b) => b.active)?.id ?? backends[0]?.id ?? ""
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const fetchBranches = useCallback(
    async (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (!project) return;
      setIsLoadingBranches(true);
      setBranchError(null);
      setSelectedBranch("");
      try {
        const b = await gitBranches(project.path);
        setBranches(b);
      } catch {
        setBranchError("Could not load branches");
        setBranches([]);
      } finally {
        setIsLoadingBranches(false);
      }
    },
    [projects]
  );

  const handleProjectChange = (id: string) => {
    setSelectedProjectId(id);
    fetchBranches(id);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text");
    if (text.length > 1000) {
      e.preventDefault();
      const name = `pasted_${format(new Date(), "ddMMyyyyHHmm")}.txt`;
      setAttachments((prev) => [
        ...prev,
        {
          name,
          content: text,
          encoding: "utf8",
          size: new TextEncoder().encode(text).byteLength,
        },
      ]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    for (const file of Array.from(e.dataTransfer.files)) {
      if (file.size > 2 * 1024 * 1024) {
        setError(`File too large (max 2 MB): ${file.name}`);
        continue;
      }
      const isText =
        file.type.startsWith("text/") ||
        file.name.endsWith(".txt") ||
        file.name.endsWith(".md");
      if (isText) {
        const content = await file.text();
        setAttachments((prev) => [
          ...prev,
          { name: file.name, content, encoding: "utf8", size: file.size },
        ]);
      } else {
        const buffer = await file.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
        setAttachments((prev) => [
          ...prev,
          { name: file.name, content: base64, encoding: "base64", size: file.size },
        ]);
      }
    }
  };

  const removeAttachment = (index: number) =>
    setAttachments((prev) => prev.filter((_, i) => i !== index));

  const canSend =
    prompt.trim().length > 0 &&
    !!selectedProjectId &&
    !!selectedBranch &&
    !!selectedBackendId &&
    !isSending;

  const handleSend = async () => {
    if (!canSend) return;
    setIsSending(true);
    setError(null);
    try {
      await onSend({
        prompt: prompt.trim(),
        projectId: selectedProjectId,
        branch: selectedBranch,
        agentBackend: selectedBackendId,
        attachments,
      });
      setPrompt("");
      setAttachments([]);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      data-testid="task-composer"
      className={cn(
        "border-b border-border bg-card/50 p-3",
        isDraggingOver && "ring-1 ring-inset ring-primary"
      )}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDrop}
    >
      <div className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        Task Composer
      </div>

      <textarea
        data-testid="composer-prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onPaste={handlePaste}
        onKeyDown={(e) => e.key === "Enter" && e.metaKey && handleSend()}
        placeholder="What needs to be done?"
        rows={2}
        className="w-full resize-none rounded-sm border border-border bg-background p-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        style={{ maxHeight: "12rem" } as React.CSSProperties}
      />

      {attachments.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {attachments.map((a, i) => (
            <span
              key={i}
              data-testid="composer-attachment"
              className="flex items-center gap-1 rounded-sm border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              <Paperclip className="h-2.5 w-2.5" />
              {a.name}
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                data-testid="composer-remove-attachment"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <Select value={selectedProjectId} onValueChange={handleProjectChange}>
          <SelectTrigger className="h-7 w-36 text-[11px]" data-testid="composer-project">
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-[11px]">
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={selectedBranch}
          onValueChange={setSelectedBranch}
          disabled={!selectedProjectId || isLoadingBranches}
        >
          <SelectTrigger className="h-7 w-40 text-[11px]" data-testid="composer-branch">
            <SelectValue
              placeholder={
                isLoadingBranches ? "Loading…" : (branchError ?? "Branch / Worktree")
              }
            />
          </SelectTrigger>
          <SelectContent>
            {branches.map((b) => (
              <SelectItem key={b} value={b} className="text-[11px]">
                {b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedBackendId} onValueChange={setSelectedBackendId}>
          <SelectTrigger className="h-7 w-32 text-[11px]" data-testid="composer-agent">
            <SelectValue placeholder="Agent" />
          </SelectTrigger>
          <SelectContent>
            {backends.map((b) => (
              <SelectItem key={b.id} value={b.id} className="text-[11px]">
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          size="sm"
          onClick={handleSend}
          disabled={!canSend}
          data-testid="composer-send"
          className="ml-auto h-7 px-3 text-[11px]"
        >
          <Send className="mr-1 h-3 w-3" />
          Send
        </Button>
      </div>

      {error && (
        <div data-testid="composer-error" className="mt-1.5 text-[10px] text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run test -- src/panels/kanban/TaskComposer.test.tsx
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/panels/kanban/TaskComposer.tsx src/panels/kanban/TaskComposer.test.tsx
git commit -m "feat(kanban): TaskComposer with project/branch/agent selectors, file DnD, paste-to-attachment"
```

---

## Task 8: KanbanCard Redesign

**Files:**
- Modify: `src/panels/kanban/KanbanCard.tsx`
- Modify: `src/panels/kanban/KanbanCard.test.tsx`

- [ ] **Step 1: Add new test cases to `src/panels/kanban/KanbanCard.test.tsx`**

First, add the `DiffStat` import at the top of the file alongside existing imports:

```ts
import type { DiffStat } from "@/lib/ipc";
```

Then add after the existing tests inside `describe("KanbanCard")`:

  it("shows branch and diff stats when workspaceId and diffStat provided", () => {
    const diffStat: DiffStat = { added: 42, removed: 7 };
    renderWithProviders(
      <KanbanCard
        task={makeKanbanTask({ branch: "feat/foo", workspaceId: "ws-1" })}
        index={0}
        diffStat={diffStat}
        onEdit={vi.fn()}
      />
    );
    expect(screen.getByText("feat/foo")).toBeInTheDocument();
    expect(screen.getByText("+42")).toBeInTheDocument();
    expect(screen.getByText("-7")).toBeInTheDocument();
  });

  it("hides diff stats row when no branch set", () => {
    renderWithProviders(
      <KanbanCard
        task={makeKanbanTask({ branch: "" })}
        index={0}
        onEdit={vi.fn()}
      />
    );
    expect(screen.queryByTestId("agent-dot")).not.toBeInTheDocument();
  });

  it("renders green agent dot for in_progress", () => {
    renderWithProviders(
      <KanbanCard
        task={makeKanbanTask({ status: "in_progress", branch: "main" })}
        index={0}
        onEdit={vi.fn()}
      />
    );
    expect(screen.getByTestId("agent-dot")).toHaveClass("bg-green-500");
  });

  it("renders amber dot for review", () => {
    renderWithProviders(
      <KanbanCard
        task={makeKanbanTask({ status: "review", branch: "main" })}
        index={0}
        onEdit={vi.fn()}
      />
    );
    expect(screen.getByTestId("agent-dot")).toHaveClass("bg-yellow-500");
  });

  it("shows Start button for todo status", () => {
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ status: "todo" })} index={0} onEdit={vi.fn()} />
    );
    expect(screen.getByTestId("kanban-start")).toBeInTheDocument();
  });

  it("shows View button for in_progress status", () => {
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ status: "in_progress" })} index={0} onEdit={vi.fn()} />
    );
    expect(screen.getByTestId("kanban-view")).toBeInTheDocument();
  });

  it("shows Create PR button for review status", () => {
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ status: "review" })} index={0} onEdit={vi.fn()} />
    );
    expect(screen.getByTestId("kanban-create-pr")).toBeInTheDocument();
  });

  it("shows no action button for done status", () => {
    renderWithProviders(
      <KanbanCard task={makeKanbanTask({ status: "done" })} index={0} onEdit={vi.fn()} />
    );
    expect(screen.queryByTestId("kanban-start")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kanban-view")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kanban-create-pr")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify new tests fail**

```bash
bun run test -- src/panels/kanban/KanbanCard.test.tsx
```

Expected: new tests fail; existing tests may also fail due to `status: "todo"` fixture change.

- [ ] **Step 3: Replace `src/panels/kanban/KanbanCard.tsx`**

```tsx
import { Draggable } from "@hello-pangea/dnd";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatDistanceToNow } from "date-fns";
import { Eye, GitPullRequest, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWorkbench } from "@/state/store";
import { workspaceCreate } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { DiffStat, KanbanTask } from "@/lib/ipc";

interface Props {
  task: KanbanTask;
  index: number;
  diffStat?: DiffStat;
  onEdit: () => void;
}

const AGENT_DOT: Record<KanbanTask["status"], string> = {
  in_progress: "bg-green-500",
  review: "bg-yellow-500",
  todo: "bg-muted-foreground",
  done: "bg-muted-foreground",
};

export default function KanbanCard({ task, index, diffStat, onEdit }: Props) {
  const addWorkspace = useWorkbench((s) => s.addWorkspace);
  const setActiveWorkspace = useWorkbench((s) => s.setActiveWorkspace);
  const backends = useWorkbench((s) => s.backends);
  const workspaces = useWorkbench((s) => s.workspaces);

  const startInMaverick = async () => {
    const backend =
      task.agentBackend ||
      backends.find((b) => b.active)?.id ||
      backends[0]?.id ||
      "claude";
    try {
      const ws = await workspaceCreate(task.projectId, task.branch || "main", backend);
      addWorkspace(ws);
      setActiveWorkspace(ws.id);
    } catch (e) {
      console.error("Failed to start workspace", e);
    }
  };

  const viewWorkspace = () => {
    const ws = workspaces.find((w) => w.id === task.workspaceId);
    if (ws) setActiveWorkspace(ws.id);
  };

  const ActionButton = () => {
    switch (task.status) {
      case "todo":
        return (
          <Button
            size="sm"
            variant="ghost"
            onClick={startInMaverick}
            data-testid="kanban-start"
            className="h-5 px-1.5 text-[10px]"
          >
            <Play className="mr-1 h-2.5 w-2.5" />
            Start
          </Button>
        );
      case "in_progress":
        return (
          <Button
            size="sm"
            variant="ghost"
            onClick={viewWorkspace}
            data-testid="kanban-view"
            className="h-5 px-1.5 text-[10px]"
          >
            <Eye className="mr-1 h-2.5 w-2.5" />
            View
          </Button>
        );
      case "review":
        return (
          <Button
            size="sm"
            variant="ghost"
            data-testid="kanban-create-pr"
            className="h-5 px-1.5 text-[10px]"
          >
            <GitPullRequest className="mr-1 h-2.5 w-2.5" />
            Create PR
          </Button>
        );
      default:
        return null;
    }
  };

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          data-testid="kanban-card"
          className={cn(
            "group rounded-sm border border-border bg-card p-2 text-xs transition-shadow",
            snapshot.isDragging && "shadow-lg ring-1 ring-primary"
          )}
        >
          {task.branch && (
            <div className="mb-1 flex items-center justify-between">
              <span className="max-w-[160px] truncate text-[10px] text-muted-foreground">
                {task.branch}
              </span>
              <div className="flex items-center gap-1.5">
                {diffStat && (diffStat.added > 0 || diffStat.removed > 0) && (
                  <span className="text-[10px]">
                    <span className="text-green-500">+{diffStat.added}</span>{" "}
                    <span className="text-red-500">-{diffStat.removed}</span>
                  </span>
                )}
                <span
                  className={cn("h-2 w-2 rounded-full", AGENT_DOT[task.status])}
                  data-testid="agent-dot"
                />
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={onEdit}
            className="block w-full text-left"
            data-testid="kanban-card-edit"
          >
            <h4 className="mb-1 font-medium text-foreground">{task.title}</h4>
            {task.description && (
              <div className="prose-xs line-clamp-2 text-[11px] text-muted-foreground">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.description}</ReactMarkdown>
              </div>
            )}
          </button>

          {task.labels.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {task.labels.map((l) => (
                <Badge key={l} variant="outline">
                  {l}
                </Badge>
              ))}
            </div>
          )}

          <div className="mt-1.5 flex items-center">
            <ActionButton />
            <span className="ml-auto text-[10px] text-muted-foreground">
              {formatDistanceToNow(new Date(task.createdAt * 1000), { addSuffix: true })}
            </span>
          </div>
        </div>
      )}
    </Draggable>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run test -- src/panels/kanban/KanbanCard.test.tsx
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/panels/kanban/KanbanCard.tsx src/panels/kanban/KanbanCard.test.tsx
git commit -m "feat(kanban): KanbanCard redesign – branch row, diff stats, agent dot, contextual actions"
```

---

## Task 9: KanbanColumn Update

**Files:**
- Modify: `src/panels/kanban/KanbanColumn.tsx`
- Modify: `src/panels/kanban/KanbanColumn.test.tsx`

- [ ] **Step 1: Replace `src/panels/kanban/KanbanColumn.tsx`**

```tsx
import { Droppable } from "@hello-pangea/dnd";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DiffStat, KanbanTask } from "@/lib/ipc";
import KanbanCard from "./KanbanCard";

interface Props {
  status: KanbanTask["status"];
  tasks: KanbanTask[];
  diffStatCache: Map<string, DiffStat>;
  onEdit: (task: KanbanTask) => void;
}

const LABELS: Record<KanbanTask["status"], string> = {
  todo: "Todo",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

export default function KanbanColumn({ status, tasks, diffStatCache, onEdit }: Props) {
  return (
    <div
      data-testid={`kanban-column-${status}`}
      className="flex w-72 shrink-0 flex-col rounded-md border border-border bg-card/30"
    >
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {LABELS[status]}
        </span>
        <Badge variant="outline">{tasks.length}</Badge>
      </div>
      <Droppable droppableId={status}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn(
              "flex-1 space-y-1.5 p-1.5 transition-colors",
              snapshot.isDraggingOver && "bg-accent/10"
            )}
          >
            {tasks.map((task, index) => (
              <KanbanCard
                key={task.id}
                task={task}
                index={index}
                diffStat={task.workspaceId ? diffStatCache.get(task.workspaceId) : undefined}
                onEdit={() => onEdit(task)}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}
```

- [ ] **Step 2: Update `src/panels/kanban/KanbanColumn.test.tsx`**

Replace the entire file:

```tsx
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import KanbanColumn from "./KanbanColumn";
import { makeKanbanTask } from "@/test/fixtures";
import type { DiffStat } from "@/lib/ipc";

const emptyCache = new Map<string, DiffStat>();

describe("KanbanColumn", () => {
  it("renders status header, badge count, and triggers onEdit via card click", async () => {
    const onEdit = vi.fn();
    renderWithProviders(
      <KanbanColumn
        status="in_progress"
        tasks={[makeKanbanTask({ id: "t1", title: "x", status: "in_progress" })]}
        diffStatCache={emptyCache}
        onEdit={onEdit}
      />
    );
    expect(screen.getByTestId("kanban-column-in_progress")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("kanban-card-edit"));
    expect(onEdit).toHaveBeenCalled();
  });

  it("renders zero count when tasks empty", () => {
    renderWithProviders(
      <KanbanColumn status="done" tasks={[]} diffStatCache={emptyCache} onEdit={vi.fn()} />
    );
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("passes diffStat to card when workspaceId matches cache", () => {
    const cache = new Map<string, DiffStat>([["ws-1", { added: 5, removed: 2 }]]);
    renderWithProviders(
      <KanbanColumn
        status="in_progress"
        tasks={[makeKanbanTask({ workspaceId: "ws-1", branch: "main", status: "in_progress" })]}
        diffStatCache={cache}
        onEdit={vi.fn()}
      />
    );
    expect(screen.getByText("+5")).toBeInTheDocument();
    expect(screen.getByText("-2")).toBeInTheDocument();
  });

  it("renders todo column label", () => {
    renderWithProviders(
      <KanbanColumn status="todo" tasks={[]} diffStatCache={emptyCache} onEdit={vi.fn()} />
    );
    expect(screen.getByText("Todo")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run tests**

```bash
bun run test -- src/panels/kanban/KanbanColumn.test.tsx
```

Expected: all 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/panels/kanban/KanbanColumn.tsx src/panels/kanban/KanbanColumn.test.tsx
git commit -m "feat(kanban): KanbanColumn accepts diffStatCache, renames backlog→todo label"
```

---

## Task 10: KanbanTaskDialog Update

**Files:**
- Modify: `src/panels/kanban/KanbanTaskDialog.tsx`
- Modify: `src/panels/kanban/KanbanTaskDialog.test.tsx`

- [ ] **Step 1: Replace `src/panels/kanban/KanbanTaskDialog.tsx`**

```tsx
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { KanbanTask } from "@/lib/ipc";

interface Props {
  open: boolean;
  task?: Partial<KanbanTask>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (task: Partial<KanbanTask>) => void;
}

const STATUSES: KanbanTask["status"][] = ["todo", "in_progress", "review", "done"];

export default function KanbanTaskDialog({ open, task, onOpenChange, onSubmit }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<KanbanTask["status"]>("todo");
  const [labelInput, setLabelInput] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [agentBackend, setAgentBackend] = useState("");
  const [branch, setBranch] = useState("");

  useEffect(() => {
    if (open) {
      setTitle(task?.title ?? "");
      setDescription(task?.description ?? "");
      setStatus(task?.status ?? "todo");
      setLabels(task?.labels ?? []);
      setLabelInput("");
      setDueDate(
        task?.dueDate
          ? new Date(task.dueDate * 1000).toISOString().slice(0, 10)
          : ""
      );
      setAgentBackend(task?.agentBackend ?? "");
      setBranch(task?.branch ?? "");
    }
  }, [open, task]);

  const addLabel = () => {
    const trimmed = labelInput.trim();
    if (!trimmed || labels.includes(trimmed)) return;
    setLabels([...labels, trimmed]);
    setLabelInput("");
  };

  const submit = () => {
    if (!title.trim()) return;
    const payload: Partial<KanbanTask> = {
      ...(task?.id ? { id: task.id } : {}),
      title: title.trim(),
      description,
      status,
      labels,
      agentBackend,
      branch,
      attachments: task?.attachments ?? [],
      ...(dueDate ? { dueDate: Math.floor(new Date(dueDate).getTime() / 1000) } : {}),
      ...(task?.projectId ? { projectId: task.projectId } : {}),
      ...(task?.columnOrder !== undefined ? { columnOrder: task.columnOrder } : {}),
    };
    onSubmit(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="kanban-task-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle>{task?.id ? "Edit task" : "New task"}</DialogTitle>
          <DialogDescription>Track work for this project.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
            Title
          </label>
          <Input
            data-testid="kanban-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />

          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
            Description (markdown)
          </label>
          <textarea
            data-testid="kanban-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="w-full resize-none rounded-sm border border-border bg-input p-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />

          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
            Status
          </label>
          <div className="flex gap-1.5 flex-wrap">
            {STATUSES.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={status === s ? "default" : "outline"}
                onClick={() => setStatus(s)}
                data-testid={`status-${s}`}
              >
                {s.replace("_", " ")}
              </Button>
            ))}
          </div>

          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
            Labels
          </label>
          <div className="flex gap-2">
            <Input
              data-testid="kanban-label-input"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addLabel())}
              placeholder="Add label and press Enter"
            />
            <Button size="sm" variant="outline" onClick={addLabel}>
              Add
            </Button>
          </div>
          {labels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {labels.map((l) => (
                <Badge
                  key={l}
                  variant="outline"
                  onClick={() => setLabels(labels.filter((x) => x !== l))}
                  className="cursor-pointer"
                >
                  {l} ×
                </Badge>
              ))}
            </div>
          )}

          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
            Due date
          </label>
          <Input
            type="date"
            data-testid="kanban-due"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />

          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
            Branch
          </label>
          <Input
            data-testid="kanban-branch"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="main"
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!title.trim()}
            onClick={submit}
            data-testid="kanban-submit"
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Update status references in `src/panels/kanban/KanbanTaskDialog.test.tsx`**

Open the file. Find every occurrence of `"backlog"` and replace with `"todo"`. Find `data-testid="status-backlog"` and replace with `data-testid="status-todo"`.

- [ ] **Step 3: Run tests**

```bash
bun run test -- src/panels/kanban/KanbanTaskDialog.test.tsx
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/panels/kanban/KanbanTaskDialog.tsx src/panels/kanban/KanbanTaskDialog.test.tsx
git commit -m "feat(kanban): KanbanTaskDialog renames backlog→todo, adds branch field"
```

---

## Task 11: KanbanBoard Redesign

**Files:**
- Modify: `src/panels/kanban/KanbanBoard.tsx`
- Modify: `src/panels/kanban/KanbanBoard.test.tsx`

- [ ] **Step 1: Replace `src/panels/kanban/KanbanBoard.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { motion, useReducedMotion } from "framer-motion";
import { useWorkbench } from "@/state/store";
import {
  gitDiffStat,
  kanbanList,
  kanbanUpsert,
  workspaceCreate,
} from "@/lib/tauri";
import type { DiffStat, KanbanTask } from "@/lib/ipc";
import KanbanColumn from "./KanbanColumn";
import KanbanTaskDialog from "./KanbanTaskDialog";
import TaskComposer, { type ComposerPayload } from "./TaskComposer";
import ProjectFilterTabs from "./ProjectFilterTabs";

const DEFAULT_COLUMNS: KanbanTask["status"][] = [
  "todo",
  "in_progress",
  "review",
  "done",
];

export default function KanbanBoard() {
  const workspaces = useWorkbench((s) => s.workspaces);
  const addWorkspace = useWorkbench((s) => s.addWorkspace);
  const setActiveWorkspace = useWorkbench((s) => s.setActiveWorkspace);

  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [dialogTask, setDialogTask] = useState<Partial<KanbanTask> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterProjectId, setFilterProjectId] = useState<string | null>(null);
  const [diffStatCache, setDiffStatCache] = useState<Map<string, DiffStat>>(new Map());
  const reduce = useReducedMotion();

  const refresh = useCallback(async () => {
    try {
      const list = await kanbanList("");
      setTasks(list);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    tasks
      .filter((t) => t.workspaceId && !diffStatCache.has(t.workspaceId))
      .forEach((task) => {
        const ws = workspaces.find((w) => w.id === task.workspaceId);
        if (!ws) return;
        gitDiffStat(ws.worktreePath)
          .then((stat) => {
            setDiffStatCache((prev) => new Map(prev).set(task.workspaceId!, stat));
          })
          .catch(() => {
            /* silently ignore */
          });
      });
  }, [tasks, workspaces, diffStatCache]);

  const filteredTasks = useMemo(
    () =>
      filterProjectId
        ? tasks.filter((t) => t.projectId === filterProjectId)
        : tasks,
    [tasks, filterProjectId]
  );

  const onDragEnd = useCallback(
    async (result: DropResult) => {
      if (!result.destination) return;
      const fromCol = result.source.droppableId as KanbanTask["status"];
      const toCol = result.destination.droppableId as KanbanTask["status"];
      const moved = tasks.find((t) => t.id === result.draggableId);
      if (!moved) return;

      const newOrder = [...tasks];
      const srcCol = newOrder.filter((t) => t.status === fromCol && t.id !== moved.id);
      const destCol = newOrder.filter((t) => t.status === toCol && t.id !== moved.id);
      destCol.splice(result.destination.index, 0, { ...moved, status: toCol });

      const recompute = (list: KanbanTask[]) =>
        list.map((t, i) => ({ ...t, columnOrder: i }));
      const updatedSrc = recompute(srcCol);
      const updatedDest = recompute(destCol);

      const updated = newOrder.map((t) => {
        if (t.id === moved.id) return updatedDest.find((d) => d.id === moved.id)!;
        if (t.status === fromCol) return updatedSrc.find((s) => s.id === t.id) ?? t;
        if (t.status === toCol) return updatedDest.find((s) => s.id === t.id) ?? t;
        return t;
      });

      setTasks(updated);
      try {
        await Promise.all([...updatedSrc, ...updatedDest].map((t) => kanbanUpsert(t)));
      } catch (e) {
        setError(String(e));
        await refresh();
      }
    },
    [tasks, refresh]
  );

  const upsert = useCallback(
    async (task: Partial<KanbanTask>) => {
      try {
        await kanbanUpsert(task);
        setDialogTask(null);
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh]
  );

  const onSend = useCallback(
    async (payload: ComposerPayload) => {
      const maxOrder = tasks
        .filter((t) => t.status === "todo")
        .reduce((max, t) => Math.max(max, t.columnOrder), -1);

      const task = await kanbanUpsert({
        status: "todo",
        title: payload.prompt.split("\n")[0].slice(0, 80),
        description: payload.prompt,
        agentBackend: payload.agentBackend,
        branch: payload.branch,
        attachments: payload.attachments,
        projectId: payload.projectId,
        columnOrder: maxOrder + 1,
        labels: [],
        createdAt: Math.floor(Date.now() / 1000),
      });

      const ws = await workspaceCreate(
        payload.projectId,
        payload.branch,
        payload.agentBackend
      );

      await kanbanUpsert({
        id: task.id,
        projectId: task.projectId,
        title: task.title,
        labels: task.labels,
        columnOrder: task.columnOrder,
        attachments: task.attachments,
        agentBackend: task.agentBackend,
        branch: task.branch,
        status: "in_progress",
        workspaceId: ws.id,
      });

      addWorkspace(ws);
      setActiveWorkspace(ws.id);
      await refresh();
    },
    [tasks, addWorkspace, setActiveWorkspace, refresh]
  );

  return (
    <motion.div
      data-testid="kanban-board"
      initial={reduce ? false : { opacity: 0 }}
      animate={reduce ? undefined : { opacity: 1 }}
      transition={{ type: "spring", stiffness: 240, damping: 28 }}
      className="flex h-full w-full flex-col bg-background"
    >
      <TaskComposer onSend={onSend} />
      <ProjectFilterTabs
        filterProjectId={filterProjectId}
        onFilterChange={setFilterProjectId}
      />
      {error && (
        <div className="px-3 py-1.5 text-[11px] text-destructive">{error}</div>
      )}
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto p-2">
          {DEFAULT_COLUMNS.map((col) => (
            <KanbanColumn
              key={col}
              status={col}
              tasks={filteredTasks
                .filter((t) => t.status === col)
                .sort((a, b) => a.columnOrder - b.columnOrder)}
              diffStatCache={diffStatCache}
              onEdit={(task) => setDialogTask(task)}
            />
          ))}
        </div>
      </DragDropContext>

      <KanbanTaskDialog
        open={dialogTask !== null}
        task={dialogTask ?? undefined}
        onOpenChange={(o) => !o && setDialogTask(null)}
        onSubmit={upsert}
      />
    </motion.div>
  );
}
```

- [ ] **Step 2: Replace `src/panels/kanban/KanbanBoard.test.tsx`**

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import KanbanBoard from "./KanbanBoard";
import { useWorkbench } from "@/state/store";
import { makeBackend, makeKanbanTask, makeProject, makeWorkspace } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState({
    ...initial,
    workspaces: [],
    activeWorkspaceId: null,
    projects: [],
    backends: [makeBackend()],
  });
});

describe("KanbanBoard", () => {
  it("renders without an active project (global board)", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([] as never);
    renderWithProviders(<KanbanBoard />);
    await waitFor(() => expect(screen.getByTestId("kanban-board")).toBeInTheDocument());
    expect(screen.queryByTestId("kanban-empty")).not.toBeInTheDocument();
  });

  it("calls kanbanList with empty string to fetch all tasks", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([] as never);
    renderWithProviders(<KanbanBoard />);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("kanban_list", { projectId: "" })
    );
  });

  it("renders task composer and project filter tabs", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([] as never);
    renderWithProviders(<KanbanBoard />);
    await waitFor(() => expect(screen.getByTestId("kanban-board")).toBeInTheDocument());
    expect(screen.getByTestId("task-composer")).toBeInTheDocument();
    expect(screen.getByTestId("project-filter-tabs")).toBeInTheDocument();
  });

  it("filter tab filters displayed tasks by project", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [
        makeProject({ id: "p1", name: "Alpha" }),
        makeProject({ id: "p2", name: "Beta" }),
      ],
      backends: [makeBackend()],
    });
    vi.mocked(invoke).mockResolvedValueOnce([
      makeKanbanTask({ id: "t1", projectId: "p1", title: "Alpha task" }),
      makeKanbanTask({ id: "t2", projectId: "p2", title: "Beta task" }),
    ] as never);
    renderWithProviders(<KanbanBoard />);
    await waitFor(() => screen.getByText("Alpha task"));

    await userEvent.click(screen.getByTestId("filter-project-p1"));
    expect(screen.getByText("Alpha task")).toBeInTheDocument();
    expect(screen.queryByText("Beta task")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("filter-all"));
    expect(screen.getByText("Beta task")).toBeInTheDocument();
  });

  it("onSend creates todo task then workspace then in_progress update", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", name: "A", path: "/p1" })],
      backends: [makeBackend({ id: "claude", active: true })],
    });
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === "kanban_list") return [];
      if (cmd === "git_branches") return ["main"];
      if (cmd === "kanban_upsert") return makeKanbanTask({ id: "t-new", status: "todo" });
      if (cmd === "workspace_create")
        return makeWorkspace({ id: "ws-new", projectId: "p1", branch: "main" });
      return undefined;
    }) as unknown as typeof invoke);

    renderWithProviders(<KanbanBoard />);
    await waitFor(() => expect(screen.getByTestId("kanban-board")).toBeInTheDocument());

    // Select project
    await userEvent.click(screen.getByTestId("composer-project"));
    await userEvent.click(await screen.findByText("A"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("git_branches", expect.any(Object)));

    // Select branch
    await userEvent.click(screen.getByTestId("composer-branch"));
    await userEvent.click(await screen.findByText("main"));

    // Type prompt
    await userEvent.type(screen.getByTestId("composer-prompt"), "Fix the thing");

    // Send
    await waitFor(() => expect(screen.getByTestId("composer-send")).not.toBeDisabled());
    await userEvent.click(screen.getByTestId("composer-send"));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("workspace_create", expect.any(Object))
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "kanban_upsert",
        expect.objectContaining({ task: expect.objectContaining({ status: "in_progress" }) })
      )
    );
  });

  it("kanbanList error shows error bar", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("listfail"));
    renderWithProviders(<KanbanBoard />);
    await waitFor(() => expect(screen.getByText(/listfail/)).toBeInTheDocument());
  });

  it("opens new task dialog via KanbanBoard still works", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([makeKanbanTask({ status: "todo" })] as never);
    renderWithProviders(<KanbanBoard />);
    await waitFor(() => screen.getByTestId("kanban-board"));
    await userEvent.click(screen.getByTestId("kanban-card-edit"));
    expect(screen.getByTestId("kanban-task-dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Cancel"));
  });

  it("onDragEnd reorders tasks and persists", async () => {
    const t1 = makeKanbanTask({ id: "t1", status: "todo", columnOrder: 0 });
    const t2 = makeKanbanTask({ id: "t2", status: "todo", columnOrder: 1 });
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === "kanban_list") return [t1, t2];
      if (cmd === "kanban_upsert") return t1;
      return undefined;
    }) as unknown as typeof invoke);

    renderWithProviders(<KanbanBoard />);
    await waitFor(() => screen.getByTestId("kanban-board"));

    const onDragEnd = (globalThis as Record<string, unknown>).__dndOnDragEnd as
      | ((r: unknown) => Promise<void>)
      | undefined;
    if (!onDragEnd) return;

    await onDragEnd({
      source: { droppableId: "todo", index: 0 },
      destination: { droppableId: "in_progress", index: 0 },
      draggableId: "t1",
    });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("kanban_upsert", expect.any(Object))
    );
  });
});
```

- [ ] **Step 3: Run all Kanban tests**

```bash
bun run test -- src/panels/kanban/
```

Expected: all kanban tests pass.

- [ ] **Step 4: Run full test suite with coverage**

```bash
bun run test:coverage 2>&1 | tail -20
```

Expected: coverage thresholds pass.

- [ ] **Step 5: Build check**

```bash
bun run build 2>&1 | head -20
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/panels/kanban/KanbanBoard.tsx src/panels/kanban/KanbanBoard.test.tsx
git commit -m "feat(kanban): KanbanBoard global board, Task Composer, project filter tabs, diffStat cache"
```

---

## Final Verification

- [ ] Run `bun run tauri dev` and confirm:
  - KanbanBoard renders without a project open
  - Task Composer appears at the top
  - Project tabs appear and filter cards
  - Cards show branch + diff stats when workspace is active
  - Send creates a Todo card and transitions it to In Progress
  - Pasting 1000+ chars creates a `.txt` attachment chip

- [ ] Run full sidecar test suite

```bash
cd sidecar && bun test
```

- [ ] Run Rust check

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```
