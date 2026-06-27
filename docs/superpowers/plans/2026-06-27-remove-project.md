# Remove Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user remove a project from Maverick — its workspaces, worktrees, and DB records — without ever touching the original source folder on disk.

**Architecture:** A new `project.destroy` RPC orchestrates the existing per-workspace teardown (`kill agents → archive script → remove worktree → cascade-delete DB rows`) across every workspace of a project, then deletes the project-scoped rows (`repo_configs`, `workspace_presets`, `kanban_tasks`) and the project row. Worktrees are removed before DB rows so a failure leaves the project recoverable. The UI entry point is a "Danger Zone" with a confirm dialog at the bottom of Project Settings → Identity.

**Tech Stack:** Bun + zod + Bun:sqlite (sidecar), Rust + Tauri v2 (`src-tauri`), React + Zustand + Vitest + Testing Library (`src`).

## Global Constraints

- **bun, not npm.** `bun install`, `bun run`, `bunx`.
- **shadcn primitives + Tailwind v4 utility classes only.** Use design tokens (`text-destructive`, `bg-card`, `text-muted-foreground`); no hand-rolled color/spacing values.
- **VSCode terminology** (`PrimarySideBar`, etc.). Never `Sidebar`/`RightPanel`.
- **No new dependencies.** Reuse the existing `Dialog` primitive in `src/components/ui/dialog.tsx`. Do not add `alert-dialog`.
- **Source folder is sacred.** No filesystem operation may target `project.path`. Only `~/.maverick` worktrees are removed.
- **Coverage thresholds (CI-enforced):** lines 100, branches 95, functions 100, statements 100. Every public function gets a test.
- **No `any` types. No comments explaining WHAT** — only non-obvious WHY.
- **Cross-layer types live in two places:** `src/lib/ipc.ts` (React) and `sidecar/types.ts` (Bun). Rust uses `serde_json::Value`.
- **Manual FK cascade:** schema runs `PRAGMA foreign_keys=ON` with no `ON DELETE` clauses, so every referencing row must be deleted by hand before its parent.

---

### Task 1: `sqlite-store.projectDestroy` — DB cascade for project-scoped rows

**Files:**
- Modify: `sidecar/sqlite-store.ts` (add method after `projectByPath`, ~line 183)
- Test: `sidecar/sqlite-store.test.ts`

**Interfaces:**
- Consumes: existing `store.workspaceDestroy(workspaceId)`, `store.projectAdd`, `store.workspaceCreate`, `store.db`.
- Produces: `projectDestroy(projectId: string): { ok: true }` — deletes `repo_configs`, `workspace_presets`, `kanban_tasks` for the project, then the `projects` row. Assumes the project's workspaces (and their workspace-scoped rows) are already gone.

- [ ] **Step 1: Write the failing test**

Add to `sidecar/sqlite-store.test.ts` (after the `workspaceDestroy throws on missing id` test, ~line 190):

```ts
  test("projectDestroy deletes project-scoped rows and the project", () => {
    const proj = store.projectAdd({ path: "/tmp/pd" });
    store.db
      .query(
        `INSERT INTO kanban_tasks
           (id, project_id, title, description, status, column_order, workspace_id,
            labels_json, due_date, created_at, agent_backend, branch, attachments)
         VALUES ('task_pd', ?, 't', NULL, 'todo', 0, NULL, '[]', NULL, 0, '', '', '[]')`
      )
      .run(proj.id);
    store.db
      .query(
        `INSERT INTO workspace_presets (id, project_id, name, description, base_branch, layout_json, created_at)
         VALUES ('preset_pd', ?, 'p', '', 'main', '{}', 0)`
      )
      .run(proj.id);
    store.db
      .query("INSERT INTO repo_configs (id, project_id) VALUES ('rc_pd', ?)")
      .run(proj.id);

    const r = store.projectDestroy(proj.id);

    expect(r.ok).toBe(true);
    expect(store.projectGet(proj.id)).toBeNull();
    expect(store.db.query("SELECT id FROM kanban_tasks WHERE id = 'task_pd'").get()).toBeNull();
    expect(store.db.query("SELECT id FROM workspace_presets WHERE id = 'preset_pd'").get()).toBeNull();
    expect(store.db.query("SELECT id FROM repo_configs WHERE id = 'rc_pd'").get()).toBeNull();
  });

  test("projectDestroy on a missing project is a no-op returning ok", () => {
    expect(store.projectDestroy("nope")).toEqual({ ok: true });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && bun test sqlite-store.test.ts`
Expected: FAIL — `store.projectDestroy is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `sidecar/sqlite-store.ts`, add immediately after the `projectByPath` method (~line 183):

```ts
  projectDestroy(projectId: string): { ok: true } {
    // Manual cascade: foreign_keys=ON and no ON DELETE clauses, so every table
    // referencing projects(id) must be cleared before the project row. Workspaces
    // (and their sessions/messages/context/notifications) are torn down upstream
    // per-workspace; this clears the project-scoped rows that outlive them.
    this.db.query("DELETE FROM repo_configs WHERE project_id = ?").run(projectId);
    this.db.query("DELETE FROM workspace_presets WHERE project_id = ?").run(projectId);
    this.db.query("DELETE FROM kanban_tasks WHERE project_id = ?").run(projectId);
    this.db.query("DELETE FROM projects WHERE id = ?").run(projectId);
    return { ok: true };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && bun test sqlite-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sidecar/sqlite-store.ts sidecar/sqlite-store.test.ts
git commit -m "feat(sidecar): add SQLiteStore.projectDestroy cascade"
```

---

### Task 2: Sidecar `teardownWorkspace` refactor + `project.destroy` RPC

**Files:**
- Modify: `sidecar/rpc-handlers.ts` — add `Schemas.projectDestroy` (~line 51), extract `private async teardownWorkspace(...)`, rewrite `case "workspace.destroy"` (~line 564), add `case "project.destroy"`.
- Test: `sidecar/rpc-handlers.test.ts`

**Interfaces:**
- Consumes: `store.projectDestroy` (Task 1), `store.workspaceGet`, `store.workspaceList`, `store.projectGet`, `store.workspaceDestroy`, `this.agentRunner.killWorkspace`, `this.projectSettings.read`, `this.process.spawnOnceHandle`, `this.worktree.destroy`, `shellCommandArgs`.
- Produces: RPC `"project.destroy"` accepting `{ projectId: string }`, returning `{ ok: true }`; `private async teardownWorkspace(workspaceId: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Add to `sidecar/rpc-handlers.test.ts` inside the same `describe` block that holds the `workspace.destroy` worktree tests (after the `workspace.destroy on an unknown workspace is a no-op` test, ~line 1160):

```ts
  it("project.destroy removes all workspaces, their worktrees, and the project", async () => {
    const { mkdirSync, existsSync } = await import("fs");
    const { dir, projectId, store } = makeWithTempProject();
    const removed: string[] = [];
    const fakeWorktree = {
      async resolveBaseBranch(_pp: string, c: Array<string | undefined>) {
        return c.find((x) => !!x && x.trim() !== "") ?? "HEAD";
      },
      async create() {
        const wt = `${dir}/wt-${removed.length}`;
        mkdirSync(wt, { recursive: true });
        return { workspaceId: `ws_${removed.length}`, worktreePath: wt };
      },
      async destroy({ worktreePath }: { worktreePath: string }) {
        removed.push(worktreePath);
        return { ok: true as const };
      },
      async list() { return []; },
      async prune() { return { ok: true as const }; },
    };
    const { RpcHandlers } = await import("./rpc-handlers");
    const h = new RpcHandlers({ store, worktree: fakeWorktree as never, notifier: { write: () => {} } });
    const a = (await h.dispatch("workspace.create", {
      projectId, projectPath: dir, branch: "feat/a", backend: "claude",
    })) as { id: string };
    const b = (await h.dispatch("workspace.create", {
      projectId, projectPath: dir, branch: "feat/b", backend: "claude",
    })) as { id: string };

    const result = (await h.dispatch("project.destroy", { projectId })) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(removed).toHaveLength(2);
    expect(store.projectGet(projectId)).toBeNull();
    expect(store.workspaceGet(a.id)).toBeNull();
    expect(store.workspaceGet(b.id)).toBeNull();
    expect(existsSync(dir)).toBe(true); // the source folder is never touched
  });

  it("project.destroy on an unknown project is a no-op", async () => {
    const { store } = makeWithTempProject();
    const fakeWorktree = {
      async resolveBaseBranch() { return "HEAD"; },
      async create() { return { workspaceId: "x", worktreePath: "/x" }; },
      async destroy() { throw new Error("should not be called"); },
      async list() { return []; },
      async prune() { return { ok: true as const }; },
    };
    const { RpcHandlers } = await import("./rpc-handlers");
    const h = new RpcHandlers({ store, worktree: fakeWorktree as never, notifier: { write: () => {} } });
    const result = (await h.dispatch("project.destroy", { projectId: "missing" })) as { ok: boolean };
    expect(result.ok).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && bun test rpc-handlers.test.ts`
Expected: FAIL — `project.destroy` is an unknown method (dispatch default throws / returns undefined → `result.ok` is undefined).

- [ ] **Step 3a: Add the schema**

In `sidecar/rpc-handlers.ts`, in the `Schemas` object after `projectAdd` (~line 51):

```ts
  projectDestroy: z.object({ projectId: z.string() }),
```

- [ ] **Step 3b: Extract `teardownWorkspace`**

In `sidecar/rpc-handlers.ts`, add this private method next to the other private helpers (near `requireWorkspacePaths`, ~line 428). Move the body verbatim out of the current `case "workspace.destroy"`:

```ts
  private async teardownWorkspace(workspaceId: string): Promise<void> {
    const ws = this.store.workspaceGet(workspaceId);
    if (!ws) return;
    // A headless agent must not outlive its workspace. (Preset/terminal PTYs
    // are Rust-owned and reaped by the frontend's killWorkspaceLeaves on
    // removeWorkspace — the sidecar no longer spawns any.)
    this.agentRunner.killWorkspace(workspaceId);
    const project = this.store.projectGet(ws.projectId);
    if (project) {
      const settings = this.projectSettings.read(project.path);
      if (settings.scripts.archive.trim() !== "") {
        const [archiveCmd, ...archiveArgs] = shellCommandArgs(settings.scripts.archive);
        const { proc, exited } = this.process.spawnOnceHandle({
          cwd: ws.worktreePath,
          command: archiveCmd,
          args: archiveArgs,
        });
        const archive = exited
          .then((code) => ({ code }))
          .catch((err) => {
            console.error(`[workspace.destroy] archive failed:`, err);
            return { code: -1 };
          });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<{ code: number }>((resolve) => {
          timer = setTimeout(() => {
            try {
              proc.kill();
            } catch {
              /* already exited */
            }
            resolve({ code: -2 });
          }, 30_000);
        });
        await Promise.race([archive, timeout]);
        if (timer) clearTimeout(timer);
      }
    }
    // Remove the worktree (with a prune fallback) BEFORE deleting the DB row:
    // if removal throws, the row survives so the worktree stays recoverable
    // rather than becoming an orphaned, unreferenced directory.
    await this.worktree.destroy({
      worktreePath: ws.worktreePath,
      projectPath: project?.path,
    });
    this.store.workspaceDestroy(workspaceId);
  }
```

- [ ] **Step 3c: Rewrite `case "workspace.destroy"`**

Replace the entire existing `case "workspace.destroy"` block (~lines 564-615) with the thin caller:

```ts
      case "workspace.destroy": {
        const p = Schemas.workspaceDestroy.parse(params);
        await this.teardownWorkspace(p.workspaceId);
        return { ok: true };
      }
```

- [ ] **Step 3d: Add `case "project.destroy"`**

In the same `dispatch` switch, after `case "project.list"` (~line 489), add:

```ts
      case "project.destroy": {
        const p = Schemas.projectDestroy.parse(params);
        const project = this.store.projectGet(p.projectId);
        if (!project) return { ok: true };
        for (const ws of this.store.workspaceList(p.projectId)) {
          await this.teardownWorkspace(ws.id);
        }
        this.store.projectDestroy(p.projectId);
        return { ok: true };
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && bun test rpc-handlers.test.ts`
Expected: PASS — both new tests, and all pre-existing `workspace.destroy` tests (archive-before-destroy, order, orphan-on-failure, unknown-noop) still green via the extracted helper.

- [ ] **Step 5: Commit**

```bash
git add sidecar/rpc-handlers.ts sidecar/rpc-handlers.test.ts
git commit -m "feat(sidecar): add project.destroy RPC, extract teardownWorkspace"
```

---

### Task 3: Rust `project_destroy` Tauri command

**Files:**
- Modify: `src-tauri/src/commands/project.rs` (add command)
- Modify: `src-tauri/src/commands/mod.rs:66` (export)
- Modify: `src-tauri/src/lib.rs:243` (register in `generate_handler!`)

**Interfaces:**
- Consumes: sidecar `"project.destroy"` (Task 2), `AppState.sidecar.request`.
- Produces: Tauri command `project_destroy(project_id: String)` forwarding `{ "projectId": project_id }`.

- [ ] **Step 1: Add the command**

Append to `src-tauri/src/commands/project.rs`:

```rust
#[tauri::command]
pub async fn project_destroy(state: State<'_, AppState>, project_id: String) -> Result<Value, String> {
    state
        .sidecar
        .request("project.destroy", json!({ "projectId": project_id }))
        .await
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Export it**

In `src-tauri/src/commands/mod.rs:66`, change:

```rust
pub use project::{project_add, project_list};
```

to:

```rust
pub use project::{project_add, project_destroy, project_list};
```

- [ ] **Step 3: Register it**

In `src-tauri/src/lib.rs`, in the `generate_handler![` list, add `project_destroy,` right after `project_list,` (~line 243):

```rust
            project_add,
            project_list,
            project_destroy,
```

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors. (This command is a thin pass-through with no branching, matching `project_add`/`workspace_destroy`; the existing Rust test harness pipes a fixture JSON-RPC stream and does not unit-test individual pass-through commands, so `cargo check` is the gate here.)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/project.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): add project_destroy command"
```

---

### Task 4: `projectDestroy` IPC wrapper

**Files:**
- Modify: `src/lib/tauri.ts` (add after `projectList`, ~line 59)
- Test: `src/lib/tauri.test.ts`

**Interfaces:**
- Consumes: `invoke` from `@tauri-apps/api/core`.
- Produces: `projectDestroy(projectId: string): Promise<void>` → `invoke("project_destroy", { projectId })`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/tauri.test.ts` (near the `projectAdd / projectList` test, ~line 14):

```ts
  it("projectDestroy", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined as never);
    await api.projectDestroy("proj_1");
    expect(invoke).toHaveBeenLastCalledWith("project_destroy", { projectId: "proj_1" });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/lib/tauri.test.ts`
Expected: FAIL — `api.projectDestroy is not a function`.

- [ ] **Step 3: Add the wrapper**

In `src/lib/tauri.ts`, after `projectList` (~line 59):

```ts
export async function projectDestroy(projectId: string): Promise<void> {
  return invoke("project_destroy", { projectId });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- src/lib/tauri.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tauri.ts src/lib/tauri.test.ts
git commit -m "feat(ipc): add projectDestroy wrapper"
```

---

### Task 5: store `removeProject` action

**Files:**
- Modify: `src/state/store.ts` — add `removeProject` to the mutator interface (~line 130, after `removeWorkspace`) and to the store body (after the `removeWorkspace` implementation, ~line 309).
- Test: `src/state/store.test.ts`

**Interfaces:**
- Consumes: existing `removeWorkspace` implementation (reused for per-workspace teardown), `s.projects`, `s.workspaces`, `s.projectSettings`.
- Produces: `removeProject(id: string): void` — tears down every workspace whose `projectId === id` via the existing `removeWorkspace` path, drops the project from `projects`, and closes `projectSettings` if it is open for this project.

- [ ] **Step 1: Write the failing test**

Add to `src/state/store.test.ts` inside `describe("workbench store", ...)` (after the `setProjects + addProject` test, ~line 75):

```ts
  it("removeProject tears down child workspaces, drops the project, closes its settings", () => {
    useWorkbench.getState().setProjects([
      makeProject({ id: "p-del" }),
      makeProject({ id: "p-keep" }),
    ]);
    useWorkbench.getState().setWorkspaces([
      makeWorkspace({ id: "w-a", projectId: "p-del" }),
      makeWorkspace({ id: "w-b", projectId: "p-del" }),
      makeWorkspace({ id: "w-c", projectId: "p-keep" }),
    ]);
    useWorkbench.setState({ projectSettings: { open: true, projectId: "p-del" } });

    useWorkbench.getState().removeProject("p-del");

    expect(useWorkbench.getState().projects.map((p) => p.id)).toEqual(["p-keep"]);
    expect(useWorkbench.getState().workspaces.map((w) => w.id)).toEqual(["w-c"]);
    expect(useWorkbench.getState().projectSettings.open).toBe(false);
  });

  it("removeProject leaves project settings open when a different project is removed", () => {
    useWorkbench.getState().setProjects([makeProject({ id: "p1" }), makeProject({ id: "p2" })]);
    useWorkbench.setState({ projectSettings: { open: true, projectId: "p2" } });
    useWorkbench.getState().removeProject("p1");
    expect(useWorkbench.getState().projectSettings).toEqual({ open: true, projectId: "p2" });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/state/store.test.ts`
Expected: FAIL — `removeProject is not a function`.

- [ ] **Step 3a: Declare the mutator type**

In `src/state/store.ts`, in the mutator interface after `removeWorkspace: (id: string) => void;` (~line 130):

```ts
  removeProject: (id: string) => void;
```

- [ ] **Step 3b: Implement the action**

In `src/state/store.ts`, immediately after the `removeWorkspace` implementation closes (after line ~309), add:

```ts
    removeProject: (id) => {
      // Reuse removeWorkspace's canonical teardown for each child so PTYs,
      // runners, terminal groups, and split trees are reaped — not leaked —
      // before the project row leaves the store.
      for (const w of get().workspaces.filter((ws) => ws.projectId === id)) {
        get().removeWorkspace(w.id);
      }
      set((s) => ({
        projects: s.projects.filter((p) => p.id !== id),
        projectSettings:
          s.projectSettings.open && s.projectSettings.projectId === id
            ? { ...s.projectSettings, open: false, projectId: null }
            : s.projectSettings,
      }));
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- src/state/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/store.ts src/state/store.test.ts
git commit -m "feat(store): add removeProject with child-workspace teardown"
```

---

### Task 6: `useWorkspace.removeProject` hook

**Files:**
- Modify: `src/hooks/useWorkspace.ts` — import `projectDestroy`, select `removeProject` from store, add `removeProject` callback, expose it in the return object.
- Test: `src/hooks/useWorkspace.test.tsx`

**Interfaces:**
- Consumes: `projectDestroy` (Task 4), store `removeProject` (Task 5), `killTerminalGroupLeaves`, `useWorkbench.getState().terminalGroups`.
- Produces: `removeProject(projectId: string): Promise<void>` on the hook's return value.

- [ ] **Step 1: Write the failing test**

Add to `src/hooks/useWorkspace.test.tsx` inside `describe("useWorkspace", ...)` (after the `destroy` tests, ~line 120):

```ts
  it("removeProject kills child-workspace PTYs, calls projectDestroy, and clears the project", async () => {
    leafTesting.leafPtyCache.set("w-x-1", "pty-x");
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p-x" }), makeProject({ id: "p-y" })],
      workspaces: [makeWorkspace({ id: "w-x", projectId: "p-x" })],
      activeWorkspaceId: null,
    });
    vi.mocked(invoke).mockResolvedValue(undefined as never);
    const { result } = renderHook(() => useWorkspace());
    await act(async () => {
      await result.current.removeProject("p-x");
    });
    expect(invoke).toHaveBeenCalledWith("pty_kill", { ptyId: "pty-x" });
    expect(invoke).toHaveBeenCalledWith("project_destroy", { projectId: "p-x" });
    expect(useWorkbench.getState().projects.map((p) => p.id)).toEqual(["p-y"]);
    expect(useWorkbench.getState().workspaces).toHaveLength(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/hooks/useWorkspace.test.tsx`
Expected: FAIL — `result.current.removeProject is not a function`.

- [ ] **Step 3a: Import the IPC wrapper and select the store action**

In `src/hooks/useWorkspace.ts`, add `projectDestroy` to the `@/lib/tauri` import list (~line 3-11):

```ts
import {
  workspaceCreate,
  workspaceDestroy,
  workspaceList,
  projectAdd,
  projectDestroy,
  projectList,
  detectBackends,
  bootstrapStatus,
} from "@/lib/tauri";
```

Add the store selector next to the other selectors (~line 20):

```ts
  const removeProjectFromStore = useWorkbench((s) => s.removeProject);
```

- [ ] **Step 3b: Add the callback**

In `src/hooks/useWorkspace.ts`, after the `destroy` callback (~line 56), add:

```ts
  const removeProject = useCallback(
    async (projectId: string) => {
      // Kill every child workspace's terminal PTYs first — their cwd is a
      // worktree project.destroy is about to remove. Mirrors `destroy`.
      const childIds = new Set(
        useWorkbench.getState().workspaces.filter((w) => w.projectId === projectId).map((w) => w.id)
      );
      for (const g of useWorkbench.getState().terminalGroups.filter((gr) => childIds.has(gr.workspaceId))) {
        killTerminalGroupLeaves(g.id);
      }
      await projectDestroy(projectId);
      removeProjectFromStore(projectId);
    },
    [removeProjectFromStore]
  );
```

- [ ] **Step 3c: Expose it**

In the hook's return object (~line 103), add `removeProject`:

```ts
  return {
    create,
    destroy,
    removeProject,
    refreshWorkspaces,
    addProjectFromPath,
    refreshProjects,
    refreshBackends,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- src/hooks/useWorkspace.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useWorkspace.ts src/hooks/useWorkspace.test.tsx
git commit -m "feat(hooks): add useWorkspace.removeProject"
```

---

### Task 7: Danger Zone UI in Project Settings → Identity

**Files:**
- Modify: `src/panels/project-settings/sections/IdentitySection.tsx`
- Test: `src/panels/project-settings/sections/IdentitySection.test.tsx`

**Interfaces:**
- Consumes: `useProjectSettingsStore` (`data`, `projectId`), `useWorkbench` (workspace count for the project), `useWorkspace().removeProject` (Task 6), `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription`/`DialogFooter?` — note `dialog.tsx` exports no `DialogFooter`, so lay out actions with a plain `div`. `Button` (`variant="destructive"`, `variant="outline"`). `SettingsGroup`, `SettingsRow`.
- Produces: a "Danger Zone" group with a "Remove project" button that opens a confirm Dialog; confirming calls `removeProject(projectId)`.

- [ ] **Step 1: Write the failing tests**

Replace the top of `src/panels/project-settings/sections/IdentitySection.test.tsx` so the hook is mockable, and add the danger-zone tests. The full file:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen } from "@/test/utils";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import IdentitySection from "./IdentitySection";

const removeProject = vi.fn();
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ removeProject }),
}));

const STUB = {
  name: "demo",
  rootPath: "/p/demo",
  workspaces: { branchFrom: "origin/main", filesToCopy: [] },
  remote: "origin",
  previewUrl: "",
  scripts: { setup: "", run: "", archive: "" },
  preferences: {},
};

beforeEach(() => {
  removeProject.mockReset();
  vi.mocked(invoke).mockRejectedValue(new Error("noop"));
  useProjectSettingsStore.setState({
    data: STUB,
    projectId: "p1",
    status: "loaded",
    dirty: {},
    lastError: null,
  });
});

describe("IdentitySection", () => {
  it("renders name and root path", () => {
    renderWithProviders(<IdentitySection />);
    expect(screen.getByDisplayValue("demo")).toBeInTheDocument();
    expect(screen.getByText("/p/demo")).toBeInTheDocument();
  });

  it("blur on name triggers patch", async () => {
    renderWithProviders(<IdentitySection />);
    const input = screen.getByDisplayValue("demo");
    await userEvent.clear(input);
    await userEvent.type(input, "alpha");
    await userEvent.tab();
    expect(useProjectSettingsStore.getState().dirty.name).toBe("alpha");
  });

  it("confirm dialog removes the project", async () => {
    renderWithProviders(<IdentitySection />);
    await userEvent.click(screen.getByRole("button", { name: /remove project/i }));
    // Dialog confirm button (distinct from the trigger).
    await userEvent.click(screen.getByTestId("confirm-remove-project"));
    expect(removeProject).toHaveBeenCalledWith("p1");
  });

  it("cancel does not remove the project", async () => {
    renderWithProviders(<IdentitySection />);
    await userEvent.click(screen.getByRole("button", { name: /remove project/i }));
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(removeProject).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- src/panels/project-settings/sections/IdentitySection.test.tsx`
Expected: FAIL — no "Remove project" button / no `confirm-remove-project` testid.

- [ ] **Step 3: Implement the danger zone**

Rewrite `src/panels/project-settings/sections/IdentitySection.tsx`:

```tsx
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { SettingsGroup } from "@/panels/settings/primitives/SettingsGroup";
import { SettingsRow } from "@/panels/settings/primitives/SettingsRow";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import { useWorkbench } from "@/state/store";
import { useWorkspace } from "@/hooks/useWorkspace";

export default function IdentitySection() {
  const data = useProjectSettingsStore((s) => s.data);
  const projectId = useProjectSettingsStore((s) => s.projectId);
  const patch = useProjectSettingsStore((s) => s.patch);
  const flush = useProjectSettingsStore((s) => s.flush);
  const workspaceCount = useWorkbench(
    (s) => s.workspaces.filter((w) => w.projectId === projectId).length,
  );
  const { removeProject } = useWorkspace();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!data) return null;
  const handleBlur = () => {
    void flush();
  };
  const handleRemove = () => {
    if (projectId) void removeProject(projectId);
    setConfirmOpen(false);
  };

  return (
    <div data-testid="project-identity" className="space-y-5">
      <SettingsGroup title="Identity" description="How this project appears across Maverick.">
        <SettingsRow
          title="Display name"
          description="Shown in the PROJECTS list, breadcrumbs, and Project Settings header."
          control={
            <Input
              data-testid="identity-name"
              defaultValue={data.name}
              onChange={(e) => patch({ name: e.target.value })}
              onBlur={handleBlur}
              className="w-72"
            />
          }
        />
        <SettingsRow
          title="Root path"
          description="The local directory backing this project. Move via your file manager and re-add — don't edit here."
          control={
            <div
              data-testid="identity-root-path"
              className="select-text break-all text-right font-mono text-[12px] text-muted-foreground"
            >
              {data.rootPath}
            </div>
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Danger Zone"
        description="Remove this project from Maverick. Your source folder is never deleted."
      >
        <SettingsRow
          title="Remove project"
          description="Removes the project, its workspaces, and their worktrees from Maverick. The original source folder stays on disk."
          control={
            <Button
              variant="destructive"
              size="sm"
              data-testid="open-remove-project"
              onClick={() => setConfirmOpen(true)}
            >
              Remove project
            </Button>
          }
        />
      </SettingsGroup>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`Remove "${data.name}"?`}</DialogTitle>
            <DialogDescription>
              {`This removes the project and its ${workspaceCount} workspace${workspaceCount === 1 ? "" : "s"} (and their worktrees) from Maverick. Your source folder stays on disk — only Maverick's worktrees and records are removed.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              data-testid="confirm-remove-project"
              onClick={handleRemove}
            >
              Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- src/panels/project-settings/sections/IdentitySection.test.tsx`
Expected: PASS (all four tests).

- [ ] **Step 5: Commit**

```bash
git add src/panels/project-settings/sections/IdentitySection.tsx src/panels/project-settings/sections/IdentitySection.test.tsx
git commit -m "feat(project-settings): add Remove project danger zone"
```

---

### Task 8: Full verification — build, coverage, manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Type-check + build the frontend**

Run: `bun run build`
Expected: succeeds, no TypeScript errors. (Confirms `removeProject` types thread through store → hook → component, and the `dialog.tsx` exports used actually exist.)

- [ ] **Step 2: Rust check**

Run: `cd src-tauri && cargo check`
Expected: compiles clean.

- [ ] **Step 3: Sidecar tests**

Run: `cd sidecar && bun test`
Expected: all pass.

- [ ] **Step 4: Frontend coverage**

Run: `bun run test:coverage`
Expected: passes the CI thresholds (lines 100, branches 95, functions 100, statements 100). If any new line/branch is uncovered, add the missing test before continuing — e.g. the `if (!data) return null` guard and the `projectId` falsy guard in `handleRemove` may each need a case.

- [ ] **Step 5: Manual smoke test**

Run: `bun run tauri dev`
- Add a project, create a workspace or two in it.
- Open Project Settings (gear icon on the project row) → Identity → Danger Zone → "Remove project" → confirm.
- Verify: the project + its workspaces disappear from the `PrimarySideBar`; the Project Settings panel closes; **the source folder still exists on disk**; the `~/.maverick` worktrees for those workspaces are gone.
- Restart the app and confirm the project does not reappear (DB row removed).

- [ ] **Step 6: Commit any coverage top-ups**

```bash
git add -A
git commit -m "test: cover remaining remove-project branches"
```

---

## Self-Review Notes

- **Spec coverage:** worktree destroy (Tasks 2, 6 PTY kill) ✓; source folder untouched (Task 2 test asserts `existsSync(dir)`, Task 8 manual) ✓; idempotent (Tasks 1, 2 missing-id tests) ✓; worktree-before-DB invariant (preserved by reusing `teardownWorkspace`; existing order test still runs) ✓; kanban delete (Task 1) ✓; repo_configs + presets delete (Task 1) ✓; UI danger zone + confirm (Task 7) ✓; panel closes on removal (Task 5 store action + test) ✓.
- **Type consistency:** `projectDestroy` (tauri.ts / hook), `removeProject` (store action + hook callback + return key), `teardownWorkspace` (sidecar private), `projectDestroy` (store DB method) — names used consistently across tasks. The hook's store selector is aliased `removeProjectFromStore` to avoid shadowing the hook's own `removeProject` callback.
- **Placeholder scan:** no TBD/TODO; every code step shows full code.
- **Out-of-zone note for PR:** this spans `sidecar/`, `src-tauri/`, `src/state`, `src/hooks`, `src/lib`, `src/panels/project-settings` — flag in the PR description per CLAUDE.md File Ownership, since no single subagent zone owns all of it.
