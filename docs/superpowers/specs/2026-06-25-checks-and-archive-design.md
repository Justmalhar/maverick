# Phase 1 — Checks Tab + Archive/History — Design Spec

*Date: 2026-06-25 · Branch: `Maverick-Windows` · Author context: Manan*

## 1. Problem & Intent

Phases 0–2 of the conductor-for-windows effort are essentially shipped (foundation, Agents
Dashboard, notifications, review loop with inline comments). The biggest remaining
**conductor.build** parity gap is the **back half of the workflow loop**: a workspace can be
created, an agent can run, diffs can be reviewed and a PR opened — but there is no
**merge-readiness surface** and no **archive/restore** lifecycle. Conductor closes the loop
with a **Checks** tab (merge-readiness signals + merge gating) and an **archive → History**
flow.

This spec covers both. The **immediate build target is the Checks tab**; Archive/History is
specced here and built in the following step.

### Conductor reference (from docs.conductor.build)
- **Checks** = "merge-readiness signals within a workspace": Git status, PR metadata, CI/status
  checks, deployments, GitHub comments/review threads, Todos. "Conductor may block or discourage
  merge actions when required work is still open."
- **Archive** keeps the sidebar focused; archived workspaces restore later "with chat history
  intact via the History pane."

## 2. Goals / Non-Goals

**Goals**
- A **Checks** tab in `AuxiliaryBar` aggregating, per active workspace: git status (changed
  files, ahead/behind, conflicts), PR metadata, and CI/status-check rollup — with a derived
  **merge-readiness** verdict and explicit **blockers** list.
- Data sourced from existing primitives (`git`, `gh`) — no new credentials (CLAUDE.md #5). `gh`
  absent / unauthenticated / no-PR must degrade gracefully to a neutral state, never an error
  dump (mirror `GitModule.prCreate`'s `gh` fallback).
- **Archive flow**: archive a workspace (run `scripts.archive` → `git worktree remove` →
  remove card) reusing the existing `workspace.destroy` path, but **preserving the DB row +
  chat history** instead of deleting it.
- **History pane**: list archived workspaces, restore (re-materialize worktree) with chat intact.

**Non-Goals (this phase)**
- Deployments and GitHub review-thread aggregation in Checks (Conductor lists them; defer —
  needs richer `gh` GraphQL). **Todos** in Checks are deferred until a todo source is decided
  (Kanban-task linkage vs. agent todo capture) — not stubbed (CLAUDE.md #10).
- Auto-merge. Checks **surfaces** readiness and gates the existing PR/merge affordances; it does
  not perform the merge.

## 3. Architecture

Standard three layers, reusing the established command pattern (React `lib/tauri.ts` →
`#[tauri::command]` forwarder → sidecar JSON-RPC method):

```
ChecksView (auxiliarybar)  ──checksGet──►  checks_get (commands/checks.rs)  ──"checks.get"──►  ChecksModule.get()
```

- **Sidecar `ChecksModule`** (`sidecar/checks-module.ts`): owns all git + `gh` invocation and
  normalization. Takes a `Shell` (default `defaultShell`) so it is unit-testable via the
  existing `transcript()` fake-shell harness. Pure static parsers for `gh` JSON + porcelain.
- **Rust** is a pass-through (`checks_get` → `"checks.get"`), per the layer rules.
- **Types** mirrored in `src/lib/ipc.ts` and `sidecar/types.ts`.

### 3.1 Data shape

```ts
type CheckStatus = "pass" | "fail" | "pending" | "neutral";

interface CheckItem { name: string; status: CheckStatus; detail?: string; }

interface PrInfo {
  number: number;
  url: string;
  state: string;            // OPEN | MERGED | CLOSED
  title: string;
  mergeable: string;        // MERGEABLE | CONFLICTING | UNKNOWN
}

interface ChecksReport {
  git: {
    branch: string;
    ahead: number;
    behind: number;
    changedFiles: number;
    conflicts: number;
  };
  pr: PrInfo | null;        // null when no PR / gh unavailable
  ghAvailable: boolean;     // false → PR/CI sections show a "configure gh" hint, not an error
  checks: CheckItem[];      // CI/status rollup, [] when no PR
  merge: { ready: boolean; blockers: string[] };
}
```

### 3.2 ChecksModule.get(worktreePath)

1. **branch + ahead/behind** — `git for-each-ref --format=%(HEAD)…%(upstream:track,nobracket) refs/heads`
   filtered to the current branch (reuse `GitModule.parseBranches` shape).
2. **changedFiles** — `git status --porcelain` line count.
3. **conflicts** — `git diff --name-only --diff-filter=U` line count.
4. **PR + CI** — `gh pr view --json number,state,title,url,mergeable,statusCheckRollup`
   (run in `worktreePath`). On `gh` ENOENT or "not authenticated" → `ghAvailable:false`,
   `pr:null`, `checks:[]`. On "no pull requests found" → `ghAvailable:true`, `pr:null`.
5. **normalize `statusCheckRollup`** — `CheckRun` (use `conclusion`/`status`) and `StatusContext`
   (use `state`) both map to `CheckStatus` via static `parseRollup`.
6. **merge verdict** — `blockers` accumulates: uncommitted changes, unresolved conflicts,
   behind-upstream, no PR open, PR `CONFLICTING`, failing checks, still-running checks.
   `ready = blockers.length === 0`.

### 3.3 Frontend `ChecksView`

- Subscribes to `selectContextWorkspace`; fetches `checksGet(worktreePath)` on mount + when the
  agent status transitions to quiet (cheap "tree changed" signal, same pattern as
  `DashboardView`), plus a manual refresh button.
- Sections: **Merge readiness** banner (ready → success; blocked → list blockers), **Git**
  (branch, ↑ahead ↓behind, N changed, N conflicts), **Pull request** (number/state/title link or
  "No PR — Create one" hint), **Checks** (CheckItem rows with status tone). `gh` unavailable →
  inline hint to authenticate the CLI (no key handling).
- shadcn + tokens only; `.mv-checksview`; VSCode terminology. Tab added to `AuxiliaryBar` `TABS`
  and `AuxiliaryView` union (`"checks"`).

## 4. Archive / History (built next step)

- **Archive**: new `workspace.archive` sidecar method = the `workspace.destroy` body **minus**
  `store.workspaceDestroy` — instead sets an `archivedAt` column on the workspace row (migration),
  runs `scripts.archive`, then `git worktree remove`. Card leaves the Dashboard (filter on
  `archivedAt == null`).
- **History pane**: `workspace.listArchived` + a `HistoryView`; **restore** =
  `workspace.restore` re-runs `worktree.create` from the saved branch and clears `archivedAt`.
  Chat history survives because the row + messages are never deleted.
- Reuses existing `worktree`/`process`/`store`; SQLite messages already keyed by workspace.

## 5. Testing

Per CLAUDE.md thresholds (lines 100 / branches 95 / functions 100 / statements 100).
- **`bun test`** for `ChecksModule` via the `transcript()` fake-shell harness: ahead/behind parse,
  porcelain count, conflict count, `gh` JSON happy path, `gh` ENOENT, `gh` unauth, no-PR,
  rollup normalization (CheckRun + StatusContext + mixed), every `blockers` branch, `ready` true.
- **`rpc-handlers.test.ts`**: pin `checks.get` dispatch forwards `worktreePath`.
- **Vitest + MSW** for `ChecksView`: loading, ready banner, each blocker rendered, gh-unavailable
  hint, PR link, manual refresh, no-active-workspace empty state.
- **Rust**: `checks_get` covered by the existing fixture JSON-RPC stream pattern.

## 6. Risks

- **`gh` JSON shape drift** — `statusCheckRollup` item typenames vary by check provider; the
  normalizer must default unknown shapes to `neutral`, never throw.
- **`gh` latency / hang** — wrap the `gh pr view` call with the same network-timeout guard
  pattern `GitModule.network` uses, so a stalled API surfaces as `ghAvailable:false`, not a hang.
- **Merge-gating overreach** — "still running" as a hard blocker may annoy; keep blockers
  descriptive and let the UI present them as *discouragement* (Conductor's wording), not a lock.
