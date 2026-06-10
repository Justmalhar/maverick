# Worktree Flow, Branch Picker, Git Providers & Source Control — Design

*2026-06-10 — Conductor-parity workspace creation + VSCode-style SCM in the AuxiliaryBar.*

## Problems (current behavior)

1. `+` on a project hardcodes `branch: "main"` and creates the worktree at
   `{projectPath}/.maverick/worktrees/{wsId}` — inside the user's repo.
   `git worktree add -b main … origin/main` fails whenever `main` already
   exists, and worktrees pollute the active directory.
2. The setup script runs **blocking** inside the sidecar's `workspace.create`
   with output discarded; the user stares at nothing until it finishes.
3. The "Create from" button on `ProjectItem` renders but its handler is never
   wired — there is no way to pick the base branch.
4. PR creation is hardwired to the `gh` CLI (GitHub only).
5. The full `GitPanel` exists but is unreachable; the AuxiliaryBar has no
   quick commit/push/PR surface.

## Design

### 1. Worktree location & naming

- Default worktree root becomes `~/.maverick/<project-slug>/worktrees/`
  (slug = lowercased project name, `[a-z0-9-]`). `workspaces.basePath` in
  `maverick.json` overrides it (absolute as-is, relative anchored at project).
  Existing workspaces keep working — destroy uses the stored `worktreePath`.
- Worktree directory name = the workspace's branch slug (e.g. `viper`), with a
  `-<id suffix>` fallback if the directory already exists.
- `workspace.create` `branch` becomes optional. When omitted the sidecar
  generates a unique callsign (`viper`, `phoenix`, `goose-2`, …) checked
  against `git for-each-ref refs/heads refs/remotes`. Workspace `title` is the
  capitalized callsign (new nullable `title` column, migration 005).
- Base branch resolution (first that `git rev-parse --verify --quiet` accepts):
  explicit `baseBranch` → `workspaces.branchFrom` → `origin/main` → `main` →
  `master` → `HEAD`.

### 2. Non-blocking setup → Setup tab

- Sidecar `workspace.create` no longer runs `scripts.setup`; it returns the
  workspace immediately (agent terminal spawns right away, like Conductor's
  chat box being usable while setup runs).
- Frontend: `useWorkspace.create()` marks the new workspace
  "setup pending" in the store, makes the bottom Panel visible and switches it
  to the Setup tab. `ScriptPane(kind="setup")` auto-starts the runner when the
  active workspace is pending **and** the loaded project settings belong to
  that workspace's project (guard against stale settings). Output streams into
  the existing Setup pane PTY view — never into the agent/editor area.

### 3. Create-from branch picker

- Wire `onCreateFrom`: opens a dialog with a searchable list of local + remote
  branches (`gitBranchList(project.path)`, current branch starred). Selecting
  a branch calls `create(projectId, undefined, backend, selectedBranch)` —
  generated callsign branched from the selection.

### 4. Git providers

- New `sidecar/git-provider.ts`: parse `git remote get-url <remote>` (ssh,
  ssh://, https forms) → `{ provider: github|bitbucket|gitlab|unknown, host,
  owner, repo, webUrl }`. Exposed as `git.remote_info` RPC →
  `gitRemoteInfo(worktreePath, remote?)`.
- `prCreate` becomes provider-aware. Always `git push -u <remote> <branch>`
  first, then:
  - **GitHub**: `gh pr create` (current flow); if `gh` is missing, fall back
    to the compare URL `https://<host>/<owner>/<repo>/compare/<base>...<branch>?expand=1`.
  - **Bitbucket**: `https://bitbucket.org/<owner>/<repo>/pull-requests/new?source=<branch>[&dest=<base>]`.
  - **GitLab**: `https://<host>/<owner>/<repo>/-/merge_requests/new?merge_request[source_branch]=<branch>`.
  - **Unknown**: push succeeds, error explains no provider detected.

### 5. Source Control view (AuxiliaryBar)

- New `AuxiliaryView` value `"scm"`, tab label **Source Control**, component
  `src/components/auxiliarybar/SourceControlView.tsx`:
  - Header: current branch, ahead/behind (from `gitBranchList`), provider name.
  - Commit message textarea + ✨ **Generate** button → new `ai.commit_message`
    RPC: sidecar collects `git diff HEAD --stat` + truncated diff and runs the
    user's `claude` CLI one-shot (`claude -p … --output-format text`). No API
    keys — CLI brings its own credentials (Hard Rule 5 compliant).
  - Changed-file list (from `diffGet`) with per-file checkboxes; **Commit**
    runs `gitCommit(worktreePath, message, selectedFiles)`.
  - Action row: Commit · Push · Pull · Create PR (provider-aware, shows
    returned URL).

## Layer changes

| Layer | Files |
|---|---|
| Sidecar | `name-generator.ts` (new), `git-provider.ts` (new), `commit-message.ts` (new), `worktree-manager.ts`, `git-module.ts`, `rpc-handlers.ts`, `sqlite-store.ts`, `types.ts`, `migrations/005_workspace_title.sql` |
| Rust | `commands/workspace.rs` (`branch: Option<String>`), `commands/git.rs` (`git_remote_info`, `ai_commit_message`), `commands/mod.rs`, `lib.rs` |
| Frontend | `lib/ipc.ts`, `lib/tauri.ts`, `hooks/useWorkspace.ts`, `state/store.ts` (pending-setup slice), `components/panel/Panel.tsx`, `components/primarysidebar/{ProjectsView,CreateFromDialog}.tsx`, `components/auxiliarybar/{AuxiliaryBar,SourceControlView}.tsx` |

## Testing

- Bun tests: name generator (uniqueness, suffixing), provider URL parsing
  (ssh/https/ssh:// across the three hosts), worktree base resolution +
  home-rooted default path, rpc workspace.create (generated branch, no
  blocking setup, title persisted), commit-message generator (mock shell).
- Vitest: CreateFromDialog (lists branches, fires create with baseBranch),
  Panel auto-setup (pending → runner started once, stale-settings guard),
  SourceControlView (commit flow, generate, PR url surfacing), store slice.
- `cargo check` for the Rust passthroughs; `bun run build` for the bundle.
