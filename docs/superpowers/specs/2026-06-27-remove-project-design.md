# Remove Project — Design

*Date: 2026-06-27 · Branch: `feature/delete-project`*

## Problem

Once a project is added to the PROJECTS list in the `PrimarySideBar`, there is no
way to remove it. Users need to take a project out of Maverick without deleting
their original source folder. Maverick owns the git worktrees under `~/.maverick`;
it does not own the source folder backing the project (`project.path`).

## Goals

- Remove a project — its workspaces, worktrees, and all Maverick DB records — from the app.
- **Never** touch the user's source folder (`project.path`). No filesystem operation targets it.
- Clean up the app-managed worktrees under `~/.maverick` so nothing is orphaned.
- Idempotent and crash-safe: worktrees are removed before DB rows, so a failed
  removal leaves the project recoverable rather than leaving orphaned directories.

## Non-Goals

- No archive/export of the project before removal.
- No multi-select / bulk project removal.
- No "undo" — removal is confirmed via a dialog, then final.

## Decisions (resolved during brainstorming)

| Decision | Choice |
|---|---|
| Worktree handling on removal | **Destroy** every workspace's worktree (mirror `workspace.destroy`). Source folder untouched. |
| UI entry point | **Danger Zone** at the bottom of the Project Settings panel's Identity section, gated by a confirm dialog. |
| Kanban tasks (project-scoped) | **Delete** all `kanban_tasks` for the project as part of the cascade. |

## Architecture

The existing `workspace.destroy` flow is the template. Per workspace it does:
kill headless agents → run archive script (if configured, 30s timeout) →
`worktree.destroy()` (with prune fallback) → cascade-delete workspace-scoped DB rows.
Project removal orchestrates that across every workspace, then deletes the
remaining **project-scoped** rows and the project row itself.

### 1. Sidecar (`sidecar/`)

**`rpc-handlers.ts`**

- **Refactor:** extract the per-workspace teardown currently inlined in
  `case "workspace.destroy"` into a private method `#destroyWorkspace(workspaceId)`.
  No behavior change. `case "workspace.destroy"` becomes a thin caller. This avoids
  duplicating the archive-script + worktree-removal logic in the project path.
- **Schema:** `projectDestroy: z.object({ projectId: z.string() })`.
- **Dispatch:** new `case "project.destroy"`:
  1. `const project = this.store.projectGet(p.projectId);` — if null, `return { ok: true }` (idempotent).
  2. `for (const ws of this.store.workspaceList(p.projectId)) await this.#destroyWorkspace(ws.id);`
  3. `this.store.projectDestroy(p.projectId);`
  4. `return { ok: true };`

**`sqlite-store.ts`**

- New `projectDestroy(projectId: string): { ok: true }`. By the time it runs, the
  project's workspaces (and their sessions/messages/context_usage/notifications)
  are already gone via `#destroyWorkspace` → `workspaceDestroy`. This method handles
  the rows that are **project-scoped** and would otherwise FK-block the project delete
  (schema has `foreign_keys=ON` and no `ON DELETE` clauses, so the cascade is manual):
  ```sql
  DELETE FROM repo_configs      WHERE project_id = ?;
  DELETE FROM workspace_presets WHERE project_id = ?;
  DELETE FROM kanban_tasks      WHERE project_id = ?;
  DELETE FROM projects          WHERE id = ?;
  ```

### 2. Rust (`src-tauri/`)

- **`commands/project.rs`:** add
  ```rust
  #[tauri::command]
  pub async fn project_destroy(state: State<'_, AppState>, project_id: String) -> Result<Value, String> {
      state.sidecar
          .request("project.destroy", json!({ "projectId": project_id }))
          .await
          .map_err(|e| e.to_string())
  }
  ```
- **`commands/mod.rs`:** `pub use project::{project_add, project_destroy, project_list};`
- **`lib.rs`:** add `project_destroy` to the `generate_handler!` list.

### 3. Frontend (`src/`)

**`lib/tauri.ts`**
```ts
export async function projectDestroy(projectId: string): Promise<void> {
  return invoke("project_destroy", { projectId });
}
```

**`state/store.ts`** — new `removeProject(id: string)` action. Must reuse the existing
per-workspace teardown so PTYs / runners / terminalGroups / splitTrees are reaped, not leaked:
- For each workspace whose `projectId === id`, run the same teardown `removeWorkspace`
  performs (dispose runners, kill terminal-group leaves, clear agent status, drop
  launchSpecs/splitTrees/activeGroup/etc.).
- Drop the project from `projects`.
- If `projectSettings.open && projectSettings.projectId === id`, close the panel.
- Clear `activeWorkspaceId` if it belonged to a removed workspace.

**`hooks/useWorkspace.ts`** — new `removeProject(projectId)` callback, mirroring `destroy`:
1. Kill terminal PTYs for every child workspace (`killTerminalGroupLeaves`).
2. `await projectDestroy(projectId)`.
3. `removeProject(projectId)` (store).

### 4. UI — Danger Zone in Project Settings

`src/panels/project-settings/sections/IdentitySection.tsx`:

- Append a `SettingsGroup title="Danger Zone"` after the Identity group.
- One destructive `Button` "Remove project" (Tailwind destructive tokens — `text-destructive` / `border-destructive`; no hand-rolled colors).
- Clicking opens a confirm `Dialog` (existing shadcn primitive in `src/components/ui/dialog.tsx` — no new dependency):
  - Title: `Remove "<name>"?`
  - Body names the workspace count and reassures: *"Your source folder stays on disk — only Maverick's worktrees and records are removed."*
  - Actions: `Cancel` / destructive `Remove`.
- Confirm → `useWorkspace().removeProject(projectId)` → panel closes (driven by store `removeProject` clearing `projectSettings`).
- The section reads the active `projectId` from `useProjectSettingsStore` (`data`/`projectId`) and the workspace count from `useWorkbench`.

## Data Flow

```
IdentitySection danger-zone button
  → confirm Dialog → useWorkspace.removeProject(projectId)
    → kill child-workspace PTYs (frontend)
    → projectDestroy(projectId)  [tauri.ts]
      → invoke("project_destroy")  [Rust commands/project.rs]
        → sidecar "project.destroy"  [rpc-handlers.ts]
          → for each workspace: #destroyWorkspace (agents, archive, worktree.destroy, workspaceDestroy)
          → store.projectDestroy (repo_configs, presets, kanban_tasks, projects)
    → store.removeProject(projectId)  [reap PTYs/runners/groups, drop project, close panel]
```

## Error Handling

- **Missing project:** sidecar returns `{ ok: true }` (idempotent), frontend still runs store cleanup.
- **Worktree removal failure:** `worktree.destroy()` already has a prune fallback; if it
  throws, the surrounding workspace's DB row survives (existing invariant) and the project
  DELETE will FK-fail loudly rather than silently orphaning. The thrown error surfaces to the
  frontend; the store cleanup is only run after a resolved IPC call.
- **Archive script hang:** bounded by the existing 30s timeout in `#destroyWorkspace`.

## Testing

Coverage target per CLAUDE.md: 100% lines, 95%+ branches.

- **Sidecar (`bun test`):** `project.destroy` removes all workspaces + worktrees + project-scoped
  rows (repo_configs/presets/kanban_tasks/project); idempotent on missing project;
  `#destroyWorkspace` still backs `workspace.destroy` unchanged; `sqlite-store.projectDestroy`
  cascade verified row-by-row.
- **Store (`store.test.ts`):** `removeProject` cascades workspace teardown (groups/splitTrees/
  launchSpecs cleared), closes the panel when open for that project, leaves sibling projects intact,
  clears `activeWorkspaceId` when appropriate.
- **`IdentitySection.test.tsx`:** danger zone renders; dialog gates the call; Cancel does nothing;
  Remove invokes the hook; workspace count copy is correct.
- **`tauri.ts` / `ipc`:** `projectDestroy` wrapper invokes `project_destroy` with `{ projectId }`.

## Out-of-zone touches (require COORDINATOR note in PR)

This feature legitimately spans several ownership zones (`src-tauri`, `sidecar`,
`src/state`, `src/hooks`, `src/panels/project-settings`, `src/lib`). All changes are
additive and follow the `workspace.destroy` precedent.
