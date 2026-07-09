# Agent Mode Chat UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provider-agnostic Agent Mode chat UI (Conductor-style) selectable at workspace creation, with a Claude stream-json reference adapter, plus workspace-scoped EditorTabs.

**Architecture:** Sidecar-owned provider adapters spawn AI CLIs with piped stdio (no PTY), normalize their NDJSON into a unified `AgentEvent` stream persisted to the existing `sessions`/`messages` SQLite tables and forwarded to React via the automatic JSON-RPC-notification → Tauri-event bridge (`agent.event` → `agent:event`). React renders only unified events. Spec: `docs/superpowers/specs/2026-07-02-agent-mode-chat-ui-design.md`.

**Tech Stack:** Bun sidecar (bun:sqlite, Bun.spawn), Rust/Tauri v2 pass-through commands, React 18 + zustand v5 + react-markdown/remark-gfm + shiki, shadcn primitives, react-virtuoso (new dep), Vitest + RTL + MSW, bun test.

## Global Constraints

- **bun, not npm** — `bun install`, `bun run`, `bunx`.
- **VSCode terminology** — never `Sidebar`/`RightPanel`/`CenterPanel`/`WorkspacePanel`; CSS classes `.mv-<component>`.
- **Design tokens only** — `bg-background`, `text-muted-foreground`, `gap-*`, `rounded-*`, `font-mono`, `z-*` named layers; no hand-rolled values.
- **Cross-layer types mirrored** in `src/lib/ipc.ts` AND `sidecar/types.ts`; Rust stays `serde_json::Value` pass-through.
- **No API keys** — the CLI reads its own config; we never read/store credentials.
- **Keep-alive mount** — inactive workspace content goes `display:none`, never unmounts.
- **Every public function gets a test**; new code meets 100% line / 95% branch (repo-wide `test:coverage` gate is pre-existingly red on main — run targeted tests + coverage on new files).
- **No WHAT comments**; TODOs must reference a tracked task.
- **Framer Motion** with `useReducedMotion` guard; PTY-style RAF (16ms) coalescing for stream deltas.
- **Commits** end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Verify commands run from repo root: `/Users/malharujawane/.maverick/maverick/worktrees/feature-agent-ui`.

## File Map (created ▸ / modified ▹)

```
▹ src/components/editor/EditorTabs.tsx            workspace-scoped tab strip
▸ sidecar/migrations/006_agent_mode.sql           mode column, session meta, parts_json, checkpoints
▹ sidecar/types.ts + src/lib/ipc.ts               Workspace.mode + unified agent protocol types
▹ sidecar/sqlite-store.ts                         mode, parts, session meta, checkpoints, truncation
▹ sidecar/rpc-handlers.ts                         workspace.create mode + agent.* methods
▸ sidecar/agent/provider.ts                       adapter interface + registry
▸ sidecar/agent/providers/claude.ts               Claude stream-json adapter
▸ sidecar/agent/checkpoints.ts                    git snapshot/restore (hidden ref)
▸ sidecar/agent/session-manager.ts                process lifecycle, queue, turn loop
▸ sidecar/agent/claude-session-file.ts            conversation fork (rewind)
▹ src-tauri/src/commands/mod.rs / lib.rs          register agent commands
▸ src-tauri/src/commands/agent.rs                 8 pass-through commands
▹ src/lib/tauri.ts                                agent_* wrappers + onAgentEvent
▹ src/hooks/useWorkspace.ts, ProjectsView.tsx     mode threading
▹ src/components/primarysidebar/NewWorkspaceDialog.tsx   Terminal|Agent toggle
▹ src/components/editor/WorkspaceEditor.tsx       mode branch
▸ src/state/agent-store.ts                        transcript reducer + hydrate
▸ src/lib/agent/agent-events.ts                   global listener, RAF delta buffer, status map
▸ src/components/agent/AgentChatView.tsx          root (keep-alive)
▸ src/components/agent/Transcript.tsx             virtuoso list + turn grouping
▸ src/components/agent/ChatMarkdown.tsx           markdown + code blocks
▸ src/components/agent/parts/*.tsx                UserMessage, AssistantTurn, ThinkingRow,
                                                  ToolCallRow, ActivitySection, FileChangeChip, TurnFooter
▸ src/components/agent/Composer.tsx               input, send/stop, queue
▸ src/components/agent/ComposerMenus.tsx          ModelMenu, ReasoningMenu
▸ src/components/agent/TriggerMenu.tsx            /slash + @mention popover
▸ src/components/ui/popover.tsx                   bunx shadcn add popover
```

Zone note: everything under `src/components/agent/**` + `src/lib/agent/**` belongs to the Editor/Terminal agent zone; `sidecar/**` to the sidecar agent; `src-tauri/**` to the Rust agent. Tasks below respect those boundaries.

---

### Task 1: Workspace-scoped EditorTabs

**Files:**
- Modify: `src/components/editor/EditorTabs.tsx:185-194`
- Test: `src/components/editor/EditorTabs.test.tsx`

**Interfaces:**
- Consumes: `useWorkbench` store (`workspaces`, `activeWorkspaceId`, `fileTabs`), `contextWorkspaceId` already computed at `EditorTabs.tsx:98-99`.
- Produces: no API change — visual scoping only. Keep-alive mounting in `EditorGroup.tsx` is untouched.

- [ ] **Step 1: Write the failing test**

Open `src/components/editor/EditorTabs.test.tsx`, find how existing tests seed `useWorkbench.setState` and render `<EditorTabs />` (reuse their helpers/beforeEach). Add:

```tsx
it("shows only the active workspace's tab, not other workspaces", () => {
  useWorkbench.setState({
    workspaces: [
      { id: "ws1", projectId: "p1", branch: "feature/alpha", agentBackend: "claude", worktreePath: "/tmp/a", status: "idle", sessionId: "s1" },
      { id: "ws2", projectId: "p1", branch: "feature/beta", agentBackend: "claude", worktreePath: "/tmp/b", status: "idle", sessionId: "s2" },
    ],
    activeWorkspaceId: "ws1",
  });
  render(<EditorTabs />);
  // EditorTab renders `workspace.title ?? workspace.branch` (EditorTab.tsx:57)
  expect(screen.getByText("feature/alpha")).toBeInTheDocument();
  expect(screen.queryByText("feature/beta")).not.toBeInTheDocument();
});

it("shows the owning workspace's tab when a file tab from it is active with no active workspace", () => {
  useWorkbench.setState({
    workspaces: [
      { id: "ws1", projectId: "p1", branch: "feature/alpha", agentBackend: "claude", worktreePath: "/tmp/a", status: "idle", sessionId: "s1" },
    ],
    activeWorkspaceId: null,
    fileTabs: [{ id: "ft1", workspaceId: "ws1", path: "/tmp/a/x.ts", title: "x.ts", pinned: true, dirty: false }],
    activeFileTabId: "ft1",
  });
  render(<EditorTabs />);
  expect(screen.getByText("feature/alpha")).toBeInTheDocument();
});
```

Adjust the `fileTabs` object shape to the `FileTab` type in `src/state/store.ts` if fields differ (check the type — the test must compile against it).

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `bunx vitest run src/components/editor/EditorTabs.test.tsx`
Expected: the first new test FAILS (`feature/beta` IS in the document); second passes or fails depending on current behavior.

- [ ] **Step 3: Scope the workspace tab row**

In `EditorTabs.tsx`, replace lines 185-194:

```tsx
        {workspaces
          .filter((ws) => ws.id === contextWorkspaceId)
          .map((ws) => (
            <EditorTab
              key={ws.id}
              workspace={ws}
              active={ws.id === activeId}
              onSelect={() => setActiveWorkspace(ws.id)}
              onClose={() => removeWorkspace(ws.id)}
              onContextMenu={(e) => handleTabContextMenu(e, ws.id)}
            />
          ))}
```

- [ ] **Step 4: Run the full file's tests**

Run: `bunx vitest run src/components/editor/EditorTabs.test.tsx`
Expected: ALL PASS. If a pre-existing test asserts multiple workspace tabs are visible simultaneously, update that test to assert the new scoped behavior (that is the intended product change).

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/EditorTabs.tsx src/components/editor/EditorTabs.test.tsx
git commit -m "feat(editor): scope EditorTabs strip to the active workspace

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Migration 006 + sidecar store support (mode, parts, session meta, checkpoints)

**Files:**
- Create: `sidecar/migrations/006_agent_mode.sql`
- Modify: `sidecar/types.ts` (Workspace, Message), `sidecar/sqlite-store.ts`
- Test: `sidecar/sqlite-store.test.ts` (extend existing)

**Interfaces:**
- Produces (used by Tasks 3, 6, 7, 8):
  - `Workspace.mode: "terminal" | "agent"` (type `WorkspaceMode`)
  - `Message.partsJson?: string`, `Message.turnId?: string`
  - `store.workspaceCreate(input & { mode?: WorkspaceMode })`
  - `store.sessionMetaGet(sessionId): { workspaceId: string; providerSessionId: string | null; model: string | null; reasoningLevel: string | null } | null`
  - `store.sessionMetaSet(sessionId, patch: { providerSessionId?: string | null; model?: string | null; reasoningLevel?: string | null }): { ok: true }`
  - `store.agentMessageAppend(msg: { id: string; sessionId: string; role: string; content: string; partsJson: string; turnId: string; createdAt: number }): { id: string }`
  - `store.messagesTruncateFrom(sessionId, messageId): { ok: true }` — deletes the message and everything created at-or-after it (ties broken by rowid)
  - `store.checkpointCreate(cp: { id: string; sessionId: string; messageId: string; gitSha: string; providerSessionId: string | null; providerLineCount: number; createdAt: number }): { ok: true }`
  - `store.checkpointByMessage(sessionId, messageId): Checkpoint | null`
  - `store.checkpointsTruncateFrom(sessionId, createdAt): { ok: true }`

- [ ] **Step 1: Write the migration**

`sidecar/migrations/006_agent_mode.sql`:

```sql
ALTER TABLE workspaces ADD COLUMN mode TEXT NOT NULL DEFAULT 'terminal';
ALTER TABLE sessions ADD COLUMN provider_session_id TEXT;
ALTER TABLE sessions ADD COLUMN model TEXT;
ALTER TABLE sessions ADD COLUMN reasoning_level TEXT;
ALTER TABLE messages ADD COLUMN parts_json TEXT;
ALTER TABLE messages ADD COLUMN turn_id TEXT;
CREATE TABLE IF NOT EXISTS agent_checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  git_sha TEXT NOT NULL,
  provider_session_id TEXT,
  provider_line_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_session ON agent_checkpoints(session_id, created_at)
```

No trailing semicolon after the last statement and no semicolons inside literals (the runner splits on `;` — `sqlite-store.ts:138-147`).

- [ ] **Step 2: Write failing store tests**

In `sidecar/sqlite-store.test.ts`, follow the existing construction pattern (in-memory DB + migrations dir). Add:

```ts
describe("agent mode storage", () => {
  test("workspaceCreate persists mode and defaults to terminal", () => {
    const ws = store.workspaceCreate({ projectId: "p1", branch: "b", agentBackend: "claude", worktreePath: "/tmp/w" });
    expect(ws.mode).toBe("terminal");
    const agentWs = store.workspaceCreate({ projectId: "p1", branch: "b2", agentBackend: "claude", worktreePath: "/tmp/w2", mode: "agent" });
    expect(agentWs.mode).toBe("agent");
    expect(store.workspaceGet(agentWs.id)?.mode).toBe("agent");
    expect(store.workspaceList("p1").find((w) => w.id === agentWs.id)?.mode).toBe("agent");
  });

  test("session meta round-trips", () => {
    const ws = store.workspaceCreate({ projectId: "p1", branch: "m", agentBackend: "claude", worktreePath: "/tmp/m", mode: "agent" });
    expect(store.sessionMetaGet(ws.sessionId)).toEqual({
      workspaceId: ws.id, providerSessionId: null, model: null, reasoningLevel: null,
    });
    store.sessionMetaSet(ws.sessionId, { providerSessionId: "prov1", model: "claude-sonnet-4-6" });
    expect(store.sessionMetaGet(ws.sessionId)).toEqual({
      workspaceId: ws.id, providerSessionId: "prov1", model: "claude-sonnet-4-6", reasoningLevel: null,
    });
  });

  test("agentMessageAppend + messagesList round-trip parts", () => {
    const ws = store.workspaceCreate({ projectId: "p1", branch: "pm", agentBackend: "claude", worktreePath: "/tmp/pm", mode: "agent" });
    store.agentMessageAppend({
      id: "m1", sessionId: ws.sessionId, role: "user", content: "hi",
      partsJson: JSON.stringify([{ type: "text", text: "hi" }]), turnId: "t1", createdAt: 100,
    });
    const [m] = store.messagesList({ sessionId: ws.sessionId });
    expect(m.id).toBe("m1");
    expect(m.turnId).toBe("t1");
    expect(JSON.parse(m.partsJson!)).toEqual([{ type: "text", text: "hi" }]);
  });

  test("messagesTruncateFrom deletes the message and everything after", () => {
    const ws = store.workspaceCreate({ projectId: "p1", branch: "tr", agentBackend: "claude", worktreePath: "/tmp/tr", mode: "agent" });
    for (const [id, at] of [["m1", 10], ["m2", 20], ["m3", 30]] as const) {
      store.agentMessageAppend({ id, sessionId: ws.sessionId, role: "user", content: id, partsJson: "[]", turnId: id, createdAt: at });
    }
    store.messagesTruncateFrom(ws.sessionId, "m2");
    expect(store.messagesList({ sessionId: ws.sessionId }).map((m) => m.id)).toEqual(["m1"]);
  });

  test("checkpoints create/lookup/truncate and workspaceDestroy cascade", () => {
    const ws = store.workspaceCreate({ projectId: "p1", branch: "cp", agentBackend: "claude", worktreePath: "/tmp/cp", mode: "agent" });
    store.checkpointCreate({ id: "c1", sessionId: ws.sessionId, messageId: "m1", gitSha: "sha1", providerSessionId: null, providerLineCount: 0, createdAt: 10 });
    store.checkpointCreate({ id: "c2", sessionId: ws.sessionId, messageId: "m2", gitSha: "sha2", providerSessionId: "p", providerLineCount: 4, createdAt: 20 });
    expect(store.checkpointByMessage(ws.sessionId, "m2")?.gitSha).toBe("sha2");
    store.checkpointsTruncateFrom(ws.sessionId, 20);
    expect(store.checkpointByMessage(ws.sessionId, "m2")).toBeNull();
    expect(store.checkpointByMessage(ws.sessionId, "m1")).not.toBeNull();
    store.workspaceDestroy(ws.id);
    expect(store.checkpointByMessage(ws.sessionId, "m1")).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test sidecar/sqlite-store.test.ts`
Expected: FAIL — `mode` undefined / methods not functions.

- [ ] **Step 4: Implement types + store methods**

`sidecar/types.ts` — add above `Workspace`, and extend `Workspace`/`Message`:

```ts
export type WorkspaceMode = "terminal" | "agent";
```

```ts
export interface Workspace {
  id: string;
  projectId: string;
  branch: string;
  agentBackend: string;
  worktreePath: string;
  status: "active" | "idle" | "error";
  sessionId: string;
  title?: string;
  mode: WorkspaceMode;
}

export interface Message {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallsJson?: string;
  createdAt: number;
  partsJson?: string;
  turnId?: string;
}

export interface Checkpoint {
  id: string;
  sessionId: string;
  messageId: string;
  gitSha: string;
  providerSessionId: string | null;
  providerLineCount: number;
  createdAt: number;
}
```

`sidecar/sqlite-store.ts`:
- Add `mode` to `WorkspaceRow` type and the row→object mapping in `workspaceGet`/`workspaceList` (`mode: (r.mode as WorkspaceMode) ?? "terminal"`).
- `workspaceCreate`: accept `mode?: WorkspaceMode`, include in INSERT column list with value `input.mode ?? "terminal"`, and in the returned object.
- Extend `messagesList` SELECT with `parts_json, turn_id` and map `partsJson: r.parts_json ?? undefined, turnId: r.turn_id ?? undefined`.
- Add methods (imports: `Checkpoint`, `WorkspaceMode` from `./types`):

```ts
  sessionMetaGet(sessionId: string): { workspaceId: string; providerSessionId: string | null; model: string | null; reasoningLevel: string | null } | null {
    const row = this.db
      .query<{ workspace_id: string; provider_session_id: string | null; model: string | null; reasoning_level: string | null }, [string]>(
        "SELECT workspace_id, provider_session_id, model, reasoning_level FROM sessions WHERE id = ?"
      )
      .get(sessionId);
    if (!row) return null;
    return {
      workspaceId: row.workspace_id,
      providerSessionId: row.provider_session_id,
      model: row.model,
      reasoningLevel: row.reasoning_level,
    };
  }

  sessionMetaSet(
    sessionId: string,
    patch: { providerSessionId?: string | null; model?: string | null; reasoningLevel?: string | null }
  ): { ok: true } {
    const sets: string[] = [];
    const vals: (string | null)[] = [];
    if ("providerSessionId" in patch) { sets.push("provider_session_id = ?"); vals.push(patch.providerSessionId ?? null); }
    if ("model" in patch) { sets.push("model = ?"); vals.push(patch.model ?? null); }
    if ("reasoningLevel" in patch) { sets.push("reasoning_level = ?"); vals.push(patch.reasoningLevel ?? null); }
    if (sets.length > 0) {
      this.db.query(`UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`).run(...vals, sessionId);
    }
    return { ok: true };
  }

  agentMessageAppend(msg: { id: string; sessionId: string; role: string; content: string; partsJson: string; turnId: string; createdAt: number }): { id: string } {
    this.db
      .query(
        "INSERT INTO messages (id, session_id, role, content, parts_json, turn_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(msg.id, msg.sessionId, msg.role, msg.content, msg.partsJson, msg.turnId, msg.createdAt);
    return { id: msg.id };
  }

  messagesTruncateFrom(sessionId: string, messageId: string): { ok: true } {
    const anchor = this.db
      .query<{ created_at: number; rowid: number }, [string, string]>(
        "SELECT created_at, rowid FROM messages WHERE session_id = ? AND id = ?"
      )
      .get(sessionId, messageId);
    if (anchor) {
      this.db
        .query("DELETE FROM messages WHERE session_id = ? AND (created_at > ? OR (created_at = ? AND rowid >= ?))")
        .run(sessionId, anchor.created_at, anchor.created_at, anchor.rowid);
    }
    return { ok: true };
  }

  checkpointCreate(cp: Checkpoint): { ok: true } {
    this.db
      .query(
        "INSERT INTO agent_checkpoints (id, session_id, message_id, git_sha, provider_session_id, provider_line_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(cp.id, cp.sessionId, cp.messageId, cp.gitSha, cp.providerSessionId, cp.providerLineCount, cp.createdAt);
    return { ok: true };
  }

  checkpointByMessage(sessionId: string, messageId: string): Checkpoint | null {
    const r = this.db
      .query<{ id: string; session_id: string; message_id: string; git_sha: string; provider_session_id: string | null; provider_line_count: number; created_at: number }, [string, string]>(
        "SELECT * FROM agent_checkpoints WHERE session_id = ? AND message_id = ?"
      )
      .get(sessionId, messageId);
    if (!r) return null;
    return {
      id: r.id, sessionId: r.session_id, messageId: r.message_id, gitSha: r.git_sha,
      providerSessionId: r.provider_session_id, providerLineCount: r.provider_line_count, createdAt: r.created_at,
    };
  }

  checkpointsTruncateFrom(sessionId: string, createdAt: number): { ok: true } {
    this.db.query("DELETE FROM agent_checkpoints WHERE session_id = ? AND created_at >= ?").run(sessionId, createdAt);
    return { ok: true };
  }
```

- In `workspaceDestroy`, add before the sessions DELETE:

```ts
    this.db.query("DELETE FROM agent_checkpoints WHERE session_id IN (SELECT id FROM sessions WHERE workspace_id = ?)").run(workspaceId);
```

- [ ] **Step 5: Run tests**

Run: `bun test sidecar/sqlite-store.test.ts`
Expected: ALL PASS (including all pre-existing tests — the SELECTs use `SELECT *` for workspaces so no query changes needed there).

- [ ] **Step 6: Commit**

```bash
git add sidecar/migrations/006_agent_mode.sql sidecar/types.ts sidecar/sqlite-store.ts sidecar/sqlite-store.test.ts
git commit -m "feat(sidecar): agent-mode schema — workspace mode, session meta, message parts, checkpoints

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Thread `mode` through workspace.create (sidecar RPC → Rust → React dialog)

**Files:**
- Modify: `sidecar/rpc-handlers.ts:57-63` (schema) and `:560-567` (handler)
- Modify: `src-tauri/src/commands/workspace.rs` (workspace_create)
- Modify: `src/lib/ipc.ts` (Workspace type + WorkspaceMode), `src/lib/tauri.ts:65-79` (workspaceCreate)
- Modify: `src/hooks/useWorkspace.ts:27-43`, `src/components/primarysidebar/ProjectsView.tsx:28-38`
- Modify: `src/components/primarysidebar/NewWorkspaceDialog.tsx` (mode toggle)
- Modify: `src/components/editor/WorkspaceEditor.tsx` (mode branch, placeholder view)
- Test: `sidecar/rpc-handlers.test.ts`, `src/components/primarysidebar/NewWorkspaceDialog.test.tsx`, `src/components/editor/WorkspaceEditor.test.tsx`

**Interfaces:**
- Consumes: Task 2's `WorkspaceMode`, `workspaceCreate({ …, mode })`.
- Produces: `NewWorkspacePayload.mode: WorkspaceMode`; `workspaceCreate(projectId, projectPath, branch, backend, baseBranch?, mode?)` in `src/lib/tauri.ts`; `useWorkspace().create(projectId, branch, backend, baseBranch?, mode?)`; `WorkspaceEditor` renders `AgentChatView` (placeholder until Task 11) when `workspace.mode === "agent"`.

- [ ] **Step 1: Sidecar failing test**

In `sidecar/rpc-handlers.test.ts` (follow the file's existing harness for constructing `RpcHandlers` with fakes):

```ts
test("workspace.create persists agent mode", async () => {
  const ws = await handlers.handle("workspace.create", {
    projectId, projectPath, branch: "feature/agent-x", backend: "claude", mode: "agent",
  });
  expect((ws as Workspace).mode).toBe("agent");
});
```

Run: `bun test sidecar/rpc-handlers.test.ts` → FAIL (mode is "terminal").

- [ ] **Step 2: Sidecar implementation**

Schema (`rpc-handlers.ts:57-63`):

```ts
  workspaceCreate: z.object({
    projectId: z.string(),
    projectPath: z.string(),
    branch: nullishOptional(z.string()),
    backend: z.string(),
    baseBranch: nullishOptional(z.string()),
    mode: nullishOptional(z.enum(["terminal", "agent"])),
  }),
```

Handler (`:560`): add `mode: p.mode ?? "terminal",` to the `this.store.workspaceCreate({...})` call.

Run: `bun test sidecar/rpc-handlers.test.ts` → PASS.

- [ ] **Step 3: Rust pass-through**

`src-tauri/src/commands/workspace.rs` — extend `workspace_create`:

```rust
#[tauri::command]
pub async fn workspace_create(
    state: State<'_, AppState>,
    project_id: String,
    project_path: String,
    branch: Option<String>,
    backend: String,
    base_branch: Option<String>,
    mode: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "workspace.create",
            json!({
                "projectId": project_id,
                "projectPath": project_path,
                "branch": branch,
                "backend": backend,
                "baseBranch": base_branch,
                "mode": mode,
            }),
        )
        .await
        .map_err(|e| e.to_string())
}
```

Run: `cargo check --manifest-path src-tauri/Cargo.toml` → clean.

- [ ] **Step 4: Frontend types + wrappers**

`src/lib/ipc.ts` — replace the `EditorMode` comment block (lines 31-34) and extend `Workspace`:

```ts
export type WorkspaceMode = "terminal" | "agent";

// Deprecated alias retained so persisted presets (PresetNode.mode) deserialize.
export type EditorMode = WorkspaceMode;
```

Add `mode: WorkspaceMode;` to `Workspace` (`ipc.ts:11-20`).

`src/lib/tauri.ts:65-79`:

```ts
export async function workspaceCreate(
  projectId: string,
  projectPath: string,
  branch: string | undefined,
  backend: string,
  baseBranch?: string,
  mode?: WorkspaceMode
): Promise<Workspace> {
  return invoke("workspace_create", { projectId, projectPath, branch, backend, baseBranch, mode });
}
```

(Import `WorkspaceMode` in the type import block at `tauri.ts:4-47`.)

`src/hooks/useWorkspace.ts:27-43` — extend `create`:

```ts
  const create = useCallback(
    async (projectId: string, branch: string | undefined, backend: string, baseBranch?: string, mode?: WorkspaceMode) => {
      const project = useWorkbench.getState().projects.find((p) => p.id === projectId);
      if (!project) {
        throw new Error(`Cannot create workspace: project ${projectId} not found`);
      }
      const ws = await workspaceCreate(projectId, project.path, branch, backend, baseBranch, mode);
      addWorkspace(ws);
      setActiveWorkspace(ws.id);
      useWorkbench.getState().queueSetup(ws.id);
      window.dispatchEvent(new CustomEvent("maverick:panel:tab", { detail: "setup" }));
      return ws;
    },
    [addWorkspace, setActiveWorkspace]
  );
```

`src/components/primarysidebar/ProjectsView.tsx:28-38`:

```ts
  async function onAddWorkspace(projectId: string, opts: NewWorkspacePayload) {
    try {
      const backend = opts.backend;
      const ws = await create(projectId, opts.branch, backend, opts.baseBranch, opts.mode);
      if (opts.mode !== "agent") {
        const { command, args } = resolveStartupLaunch(backend);
        useWorkbench.getState().setLaunchSpec(ws.id, { command, args });
      }
      if (opts.aiLater) useWorkbench.getState().markPendingAiRename(ws.id);
    } catch (e) {
      console.error("addWorkspace failed", e);
    }
  }
```

- [ ] **Step 5: Dialog toggle — failing test first**

`src/components/primarysidebar/NewWorkspaceDialog.test.tsx` (reuse the file's render helper):

```tsx
it("submits mode: agent when the Agent toggle is selected", async () => {
  const onSubmit = vi.fn();
  renderDialog({ onSubmit });
  await userEvent.click(screen.getByRole("button", { name: /agent/i }));
  await userEvent.type(screen.getByTestId("branch-name-input"), "chat-ui");
  await userEvent.click(screen.getByTestId("branch-create"));
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ mode: "agent" }));
});

it("defaults to terminal mode", async () => {
  const onSubmit = vi.fn();
  renderDialog({ onSubmit });
  await userEvent.type(screen.getByTestId("branch-name-input"), "shell-work");
  await userEvent.click(screen.getByTestId("branch-create"));
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ mode: "terminal" }));
});
```

Run: `bunx vitest run src/components/primarysidebar/NewWorkspaceDialog.test.tsx` → FAIL.

- [ ] **Step 6: Dialog implementation**

In `NewWorkspaceDialog.tsx`:
- Extend the payload interface:

```ts
export interface NewWorkspacePayload {
  backend: string;
  baseBranch?: string;
  branch?: string;
  aiLater?: boolean;
  mode: WorkspaceMode;
}
```

- Add state + reset (`mode` resets to "terminal" in the `open` effect and `reset()`):

```ts
const [mode, setMode] = useState<WorkspaceMode>("terminal");
```

- Include `mode` in both `onSubmit` payloads (`create()` and `aiLater()`).
- Add a segmented control styled exactly like the existing Branch type group (reuse its classes), placed above the "Coding agent" grid inside the `flex flex-col gap-5` container:

```tsx
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Workspace mode</FieldLabel>
            <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-card p-1" role="group" aria-label="Workspace mode">
              {(["terminal", "agent"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  data-testid={`workspace-mode-${m}`}
                  className={cn(
                    "relative flex items-center justify-center gap-1.5 rounded px-1 py-1.5 text-[11px] font-mono transition-colors duration-100",
                    mode === m ? "text-accent-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {mode === m ? (
                    <motion.span
                      layoutId="workspace-mode-active"
                      className="absolute inset-0 rounded bg-accent shadow-sm"
                      transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 30 }}
                    />
                  ) : null}
                  <span className="relative z-10 flex items-center gap-1.5">
                    {m === "terminal" ? <TerminalSquare className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
                    {m === "terminal" ? "Terminal" : "Agent"}
                  </span>
                </button>
              ))}
            </div>
          </div>
```

(Import `TerminalSquare, MessageSquare` from lucide-react and `WorkspaceMode` from `@/lib/ipc`.)

- [ ] **Step 7: WorkspaceEditor branch + placeholder**

Create `src/components/agent/AgentChatView.tsx` (placeholder — replaced in Task 11):

```tsx
import type { Workspace } from "@/lib/ipc";

interface Props { workspace: Workspace; visible: boolean; }

export function AgentChatView({ workspace }: Props) {
  return (
    <div data-testid={`agent-chat-${workspace.id}`} className="mv-agentchat flex h-full items-center justify-center text-sm text-muted-foreground">
      Agent chat — coming online in a later task
    </div>
  );
}
```

`src/components/editor/WorkspaceEditor.tsx` — render the chat as the workspace-primary group and keep terminal groups working. Replace the `groups.map` body:

```tsx
      {groups.map((g) => {
        const groupActive = active && g.id === activeGroupId;
        const isPrimaryAgent = workspace.mode === "agent" && g.id === workspaceId;
        return (
          <div
            key={g.id}
            data-testid={`terminal-group-${g.id}`}
            aria-hidden={!groupActive}
            className={cn("absolute inset-0", !groupActive && "keep-alive-hidden content-visibility-auto")}
          >
            {isPrimaryAgent ? (
              <AgentChatView workspace={workspace} visible={groupActive} />
            ) : (
              <TerminalView workspace={workspace} groupId={g.id} visible={groupActive} />
            )}
          </div>
        );
      })}
```

(The primary group's id === workspace.id — established convention from the workspace-tabs work — so the primary slot hosts the chat while extra terminal groups still spawn `TerminalView`.)

Test in `WorkspaceEditor.test.tsx` (mirror existing store seeding; the primary terminal group with `id === workspace.id` must exist in `terminalGroups`):

```tsx
it("renders AgentChatView for the primary group of an agent-mode workspace", () => {
  seedWorkspace({ id: "wsA", mode: "agent" });
  render(<WorkspaceEditor workspace={wsA} active />);
  expect(screen.getByTestId("agent-chat-wsA")).toBeInTheDocument();
  expect(screen.queryByTestId("terminal-wsA")).not.toBeInTheDocument();
});

it("still renders TerminalView for extra groups of an agent-mode workspace", () => {
  seedWorkspace({ id: "wsA", mode: "agent" }, { extraGroup: "g2" });
  render(<WorkspaceEditor workspace={wsA} active />);
  expect(screen.getByTestId("terminal-group-g2")).toBeInTheDocument();
});
```

Adapt selectors to what `TerminalView` actually renders in tests (check `WorkspaceEditor.test.tsx`'s existing assertions and mocks — TerminalView is likely mocked there; assert on the mock).

- [ ] **Step 8: Run all touched tests + builds**

```bash
bun test sidecar/
bunx vitest run src/components/primarysidebar/NewWorkspaceDialog.test.tsx src/components/editor/WorkspaceEditor.test.tsx src/components/editor/EditorTabs.test.tsx
cargo check --manifest-path src-tauri/Cargo.toml
bun run build
```
Expected: all pass; build clean. Fix any `Workspace` literal in other tests now missing `mode` (add `mode: "terminal"`).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(workspace): terminal|agent mode selection at creation, mode-aware WorkspaceEditor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
### Task 4: Unified agent protocol types + Claude adapter

**Files:**
- Create: `sidecar/agent/provider.ts`, `sidecar/agent/providers/claude.ts`
- Modify: `sidecar/types.ts`, `src/lib/ipc.ts` (mirrored protocol types)
- Test: `sidecar/agent/providers/claude.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 5-12):
  - Protocol types below (identical text in `sidecar/types.ts` and `src/lib/ipc.ts`)
  - `adapterFor(backend: string): AgentProviderAdapter` (claude/claude-code/default → claude adapter; unknown backends also → claude, matching `oneShotSpecFor`'s fallback)
  - `claudeAdapter: AgentProviderAdapter`

- [ ] **Step 1: Add protocol types to BOTH `sidecar/types.ts` and `src/lib/ipc.ts`**

Append verbatim to both files (below `Checkpoint` in sidecar/types.ts; below `LaunchSpec` in ipc.ts — ipc.ts also needs the `Checkpoint` + `WorkspaceMode` types if not present from Task 3):

```ts
// ---------- Agent Mode unified protocol ----------

export interface AgentFileChange {
  path: string;
  additions: number;
  deletions: number;
  kind: "edit" | "create" | "delete";
}

export type AgentPart =
  | { type: "text"; text: string }
  | { type: "thinking"; summary: string; text?: string }
  | {
      type: "tool-call";
      toolUseId: string;
      toolName: string;
      title: string;
      detail?: string;
      status: "running" | "ok" | "error";
      output?: string;
      fileChanges?: AgentFileChange[];
      durationMs?: number;
    }
  | { type: "attachment"; name: string; path: string; mime: string };

export interface AgentChatMessage {
  id: string;
  sessionId: string;
  turnId: string;
  role: "user" | "assistant" | "system";
  parts: AgentPart[];
  createdAt: number;
}

export interface QueuedMessage {
  id: string;
  parts: AgentPart[];
  createdAt: number;
}

export type AgentRunStatus = "idle" | "working" | "error";

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  durationMs: number;
}

export type AgentEvent =
  | { type: "session-meta"; providerSessionId: string; model: string }
  | { type: "message-start"; message: AgentChatMessage }
  | { type: "part-start"; messageId: string; partIndex: number; part: AgentPart }
  | { type: "part-delta"; messageId: string; partIndex: number; delta: string }
  | { type: "part-end"; messageId: string; partIndex: number; part: AgentPart }
  | { type: "message-end"; message: AgentChatMessage }
  | { type: "turn-end"; turnId: string; usage: AgentUsage }
  | { type: "status"; status: AgentRunStatus }
  | { type: "queue-updated"; queue: QueuedMessage[] }
  | { type: "permission-request"; requestId: string }
  | { type: "error"; message: string; recoverable: boolean };

export interface AgentEventPayload {
  workspaceId: string;
  sessionId: string;
  event: AgentEvent;
}

export interface AgentModelOption { id: string; label: string }
export interface AgentSlashCommand { name: string; description: string }

export interface AgentCapabilities {
  models: AgentModelOption[];
  reasoningLevels: AgentModelOption[];
  slashCommands: AgentSlashCommand[];
  supportsInterrupt: boolean;
  supportsConversationRewind: boolean;
}

export interface AgentSessionSnapshot {
  sessionId: string;
  workspaceId: string;
  status: AgentRunStatus;
  queue: QueuedMessage[];
  model: string | null;
  reasoningLevel: string | null;
  providerSessionId: string | null;
}
```

(Name is `AgentChatMessage`, not `AgentMessage`, to avoid clashing with the existing `Message` row type.)

- [ ] **Step 2: Adapter interface + registry**

`sidecar/agent/provider.ts`:

```ts
import type { AgentCapabilities, AgentEvent, AgentPart } from "../types";

export interface SpawnOpts {
  worktreePath: string;
  model: string | null;
  reasoningLevel: string | null;
  resumeSessionId: string | null;
}

export interface TurnIds {
  uuid(prefix: string): string;
  now(): number;
}

/** Per-turn mutable translation state, owned by the session manager. */
export interface TurnContext {
  sessionId: string;
  turnId: string;
  ids: TurnIds;
  current: { messageId: string; parts: AgentPart[] } | null;
  /** toolUseId → location of its running tool-call part. */
  tools: Map<string, { messageId: string; partIndex: number; startedAt: number }>;
  /** Lines the adapter could not map — surfaced in the turn footer. */
  unknownLines: number;
}

export interface AgentProviderAdapter {
  id: string;
  capabilities(worktreePath: string): AgentCapabilities;
  buildSpawn(opts: SpawnOpts): string[];
  encodeUserMessage(parts: AgentPart[]): string;
  /** Returns the control line, or null if the provider needs a signal instead. */
  encodeInterrupt(requestId: string): string | null;
  translate(line: string, ctx: TurnContext): AgentEvent[];
}

export function adapterFor(backend: string | undefined): AgentProviderAdapter {
  // Codex/Gemini adapters land later; claude is the correct fallback for every
  // currently-shipping backend id (mirrors oneShotSpecFor).
  return claudeAdapter;
}

import { claudeAdapter } from "./providers/claude";
```

(Put the import at the top of the file in real code; shown last here only to make the dependency direction obvious.)

- [ ] **Step 3: Failing adapter tests with recorded-shape fixtures**

`sidecar/agent/providers/claude.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { claudeAdapter } from "./claude";
import type { TurnContext } from "../provider";

function ctx(): TurnContext {
  let n = 0;
  return {
    sessionId: "sess1",
    turnId: "turn1",
    ids: { uuid: (p) => `${p}_${++n}`, now: () => 1000 + n },
    current: null,
    tools: new Map(),
    unknownLines: 0,
  };
}

const INIT = JSON.stringify({ type: "system", subtype: "init", session_id: "prov-abc", model: "claude-sonnet-4-6", tools: [], cwd: "/w" });
const MSG_START = JSON.stringify({ type: "stream_event", event: { type: "message_start", message: { id: "msg_1", role: "assistant", content: [] } }, session_id: "prov-abc" });
const TEXT_START = JSON.stringify({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, session_id: "prov-abc" });
const TEXT_DELTA = JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } }, session_id: "prov-abc" });
const THINK_START = JSON.stringify({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }, session_id: "prov-abc" });
const THINK_DELTA = JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "pondering" } }, session_id: "prov-abc" });
const ASSISTANT_TOOL = JSON.stringify({
  type: "assistant",
  message: { id: "msg_1", role: "assistant", model: "claude-sonnet-4-6", content: [
    { type: "text", text: "Hello" },
    { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls -la", description: "List files" } },
  ] },
  session_id: "prov-abc",
});
const TOOL_RESULT = JSON.stringify({
  type: "user",
  message: { role: "user", content: [
    { type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "file-a\nfile-b" }], is_error: false },
  ] },
  session_id: "prov-abc",
});
const EDIT_TOOL = JSON.stringify({
  type: "assistant",
  message: { id: "msg_2", role: "assistant", content: [
    { type: "tool_use", id: "toolu_2", name: "Edit", input: { file_path: "/w/src/a.ts", old_string: "aaa\nbbb", new_string: "aaa\nccc\nddd" } },
  ] },
  session_id: "prov-abc",
});
const RESULT = JSON.stringify({
  type: "result", subtype: "success", is_error: false, duration_ms: 1234, num_turns: 2,
  result: "Done.", session_id: "prov-abc", total_cost_usd: 0.05,
  usage: { input_tokens: 10, output_tokens: 20 },
});

describe("claudeAdapter.translate", () => {
  test("init → session-meta", () => {
    const evts = claudeAdapter.translate(INIT, ctx());
    expect(evts).toEqual([{ type: "session-meta", providerSessionId: "prov-abc", model: "claude-sonnet-4-6" }]);
  });

  test("text stream: message-start, part-start, part-delta", () => {
    const c = ctx();
    expect(claudeAdapter.translate(MSG_START, c).map((e) => e.type)).toEqual(["message-start"]);
    expect(claudeAdapter.translate(TEXT_START, c).map((e) => e.type)).toEqual(["part-start"]);
    const deltas = claudeAdapter.translate(TEXT_DELTA, c);
    expect(deltas).toEqual([{ type: "part-delta", messageId: c.current!.messageId, partIndex: 0, delta: "Hello" }]);
    expect(c.current!.parts[0]).toEqual({ type: "text", text: "Hello" });
  });

  test("thinking stream accumulates into summary", () => {
    const c = ctx();
    claudeAdapter.translate(MSG_START, c);
    claudeAdapter.translate(THINK_START, c);
    claudeAdapter.translate(THINK_DELTA, c);
    expect(c.current!.parts[0]).toEqual({ type: "thinking", summary: "pondering" });
  });

  test("complete assistant message reconciles text + emits running tool-call, message-end", () => {
    const c = ctx();
    claudeAdapter.translate(MSG_START, c);
    claudeAdapter.translate(TEXT_START, c);
    claudeAdapter.translate(TEXT_DELTA, c);
    const evts = claudeAdapter.translate(ASSISTANT_TOOL, c);
    const types = evts.map((e) => e.type);
    expect(types).toContain("part-start");
    expect(types[types.length - 1]).toBe("message-end");
    const end = evts.at(-1) as Extract<ReturnType<typeof claudeAdapter.translate>[number], { type: "message-end" }>;
    expect(end.message.parts).toEqual([
      { type: "text", text: "Hello" },
      { type: "tool-call", toolUseId: "toolu_1", toolName: "Bash", title: "List files", detail: "ls -la", status: "running" },
    ]);
    expect(c.tools.get("toolu_1")).toBeDefined();
    expect(c.current).toBeNull();
  });

  test("tool_result → part-end ok with truncated output", () => {
    const c = ctx();
    claudeAdapter.translate(MSG_START, c);
    claudeAdapter.translate(ASSISTANT_TOOL, c);
    const evts = claudeAdapter.translate(TOOL_RESULT, c);
    expect(evts).toHaveLength(1);
    const e = evts[0] as Extract<(typeof evts)[number], { type: "part-end" }>;
    expect(e.type).toBe("part-end");
    expect(e.part).toMatchObject({ type: "tool-call", toolUseId: "toolu_1", status: "ok", output: "file-a\nfile-b" });
  });

  test("Edit tool input yields fileChanges with +/- counts", () => {
    const c = ctx();
    claudeAdapter.translate(MSG_START, c);
    const evts = claudeAdapter.translate(EDIT_TOOL, c);
    const end = evts.at(-1) as { type: "message-end"; message: { parts: unknown[] } };
    expect(end.message.parts[0]).toMatchObject({
      type: "tool-call",
      toolName: "Edit",
      fileChanges: [{ path: "/w/src/a.ts", additions: 3, deletions: 2, kind: "edit" }],
    });
  });

  test("result → turn-end with usage", () => {
    const evts = claudeAdapter.translate(RESULT, ctx());
    expect(evts).toEqual([
      { type: "turn-end", turnId: "turn1", usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.05, durationMs: 1234 } },
    ]);
  });

  test("result with is_error → error + turn-end", () => {
    const errLine = JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, duration_ms: 5, result: "boom", session_id: "prov-abc", usage: { input_tokens: 1, output_tokens: 1 } });
    const types = claudeAdapter.translate(errLine, ctx()).map((e) => e.type);
    expect(types).toEqual(["error", "turn-end"]);
  });

  test("junk / unknown lines emit nothing and count as unknown", () => {
    const c = ctx();
    expect(claudeAdapter.translate("not json at all", c)).toEqual([]);
    expect(claudeAdapter.translate(JSON.stringify({ type: "mystery_v9" }), c)).toEqual([]);
    expect(c.unknownLines).toBe(2);
  });
});

describe("claudeAdapter encode/build", () => {
  test("encodeUserMessage renders text + attachment path refs", () => {
    const line = claudeAdapter.encodeUserMessage([
      { type: "text", text: "review this" },
      { type: "attachment", name: "shot.png", path: "/tmp/shot.png", mime: "image/png" },
    ]);
    const parsed = JSON.parse(line);
    expect(parsed.type).toBe("user");
    expect(parsed.message.role).toBe("user");
    expect(parsed.message.content[0]).toEqual({ type: "text", text: "review this\n\n[Attached file: /tmp/shot.png]" });
  });

  test("buildSpawn composes flags and omits defaults", () => {
    const cmd = claudeAdapter.buildSpawn({ worktreePath: "/w", model: "claude-opus-4-8", reasoningLevel: "high", resumeSessionId: "prov-abc" });
    expect(cmd.slice(0, 1)).toEqual(["claude"]);
    expect(cmd).toContain("--input-format");
    expect(cmd).toContain("--include-partial-messages");
    expect(cmd).toEqual(expect.arrayContaining(["--model", "claude-opus-4-8", "--effort", "high", "--resume", "prov-abc", "--permission-mode", "bypassPermissions"]));
    const bare = claudeAdapter.buildSpawn({ worktreePath: "/w", model: null, reasoningLevel: null, resumeSessionId: null });
    expect(bare).not.toContain("--model");
    expect(bare).not.toContain("--effort");
    expect(bare).not.toContain("--resume");
  });

  test("encodeInterrupt emits a control_request line", () => {
    const parsed = JSON.parse(claudeAdapter.encodeInterrupt("r1")!);
    expect(parsed).toEqual({ type: "control_request", request_id: "r1", request: { subtype: "interrupt" } });
  });
});
```

Run: `bun test sidecar/agent/providers/claude.test.ts` → FAIL (module missing).

- [ ] **Step 4: Implement the adapter**

`sidecar/agent/providers/claude.ts`:

```ts
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { AgentCapabilities, AgentEvent, AgentPart, AgentSlashCommand } from "../../types";
import type { AgentProviderAdapter, SpawnOpts, TurnContext } from "../provider";

const MAX_TOOL_OUTPUT = 4000;

const MODELS = [
  { id: "default", label: "Default" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
];

const REASONING = [
  { id: "default", label: "Default" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

function scanSlashCommands(dir: string): AgentSlashCommand[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const name = `/${f.replace(/\.md$/, "")}`;
        let description = "";
        try {
          const first = readFileSync(join(dir, f), "utf8").split("\n").find((l) => l.trim() !== "") ?? "";
          description = first.replace(/^#+\s*/, "").slice(0, 120);
        } catch {
          /* unreadable command file — list it without a description */
        }
        return { name, description };
      });
  } catch {
    return [];
  }
}

function countLines(s: string | undefined): number {
  if (!s) return 0;
  return s.split("\n").length;
}

function fileChangesFor(toolName: string, input: Record<string, unknown>): AgentPart & { type: "tool-call" } extends never ? never : { fileChanges?: { path: string; additions: number; deletions: number; kind: "edit" | "create" | "delete" }[] } {
  const path = typeof input.file_path === "string" ? input.file_path : undefined;
  if (!path) return {};
  if (toolName === "Write") {
    return { fileChanges: [{ path, additions: countLines(input.content as string), deletions: 0, kind: "create" }] };
  }
  if (toolName === "Edit" || toolName === "MultiEdit") {
    const edits = Array.isArray(input.edits) ? (input.edits as Array<Record<string, unknown>>) : [input];
    let additions = 0;
    let deletions = 0;
    for (const e of edits) {
      additions += countLines(e.new_string as string);
      deletions += countLines(e.old_string as string);
    }
    return { fileChanges: [{ path, additions, deletions, kind: "edit" }] };
  }
  return {};
}

function toolTitle(name: string, input: Record<string, unknown>): { title: string; detail?: string } {
  if (typeof input.description === "string" && input.description) {
    return { title: input.description, detail: typeof input.command === "string" ? input.command : undefined };
  }
  if (typeof input.command === "string") return { title: name, detail: input.command };
  if (typeof input.file_path === "string") return { title: name, detail: input.file_path };
  if (typeof input.pattern === "string") return { title: name, detail: input.pattern };
  return { title: name };
}

function toolCallPart(block: { id: string; name: string; input?: Record<string, unknown> }): AgentPart {
  const input = block.input ?? {};
  const { title, detail } = toolTitle(block.name, input);
  return {
    type: "tool-call",
    toolUseId: block.id,
    toolName: block.name,
    title,
    ...(detail !== undefined ? { detail } : {}),
    status: "running",
    ...fileChangesFor(block.name, input),
  };
}

function openMessage(ctx: TurnContext): AgentEvent[] {
  const messageId = ctx.ids.uuid("amsg");
  ctx.current = { messageId, parts: [] };
  return [
    {
      type: "message-start",
      message: { id: messageId, sessionId: ctx.sessionId, turnId: ctx.turnId, role: "assistant", parts: [], createdAt: ctx.ids.now() },
    },
  ];
}

function closeMessage(ctx: TurnContext): AgentEvent[] {
  if (!ctx.current) return [];
  const { messageId, parts } = ctx.current;
  ctx.current = null;
  return [
    {
      type: "message-end",
      message: { id: messageId, sessionId: ctx.sessionId, turnId: ctx.turnId, role: "assistant", parts, createdAt: ctx.ids.now() },
    },
  ];
}

function textFromResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === "object" && (c as { type?: string }).type === "text" ? (c as { text?: string }).text ?? "" : ""))
      .join("\n");
  }
  return "";
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function translateStreamEvent(ev: any, ctx: TurnContext): AgentEvent[] {
  switch (ev?.type) {
    case "message_start":
      return openMessage(ctx);
    case "content_block_start": {
      if (!ctx.current) return [];
      const block = ev.content_block ?? {};
      let part: AgentPart | null = null;
      if (block.type === "text") part = { type: "text", text: block.text ?? "" };
      else if (block.type === "thinking") part = { type: "thinking", summary: block.thinking ?? "" };
      else return []; // tool_use arrives authoritatively via the complete assistant message
      const partIndex = ctx.current.parts.length;
      ctx.current.parts.push(part);
      return [{ type: "part-start", messageId: ctx.current.messageId, partIndex, part }];
    }
    case "content_block_delta": {
      if (!ctx.current || ctx.current.parts.length === 0) return [];
      const partIndex = ctx.current.parts.length - 1;
      const part = ctx.current.parts[partIndex];
      const d = ev.delta ?? {};
      let delta = "";
      if (d.type === "text_delta" && part.type === "text") {
        delta = d.text ?? "";
        part.text += delta;
      } else if (d.type === "thinking_delta" && part.type === "thinking") {
        delta = d.thinking ?? "";
        part.summary += delta;
      } else {
        return [];
      }
      if (delta === "") return [];
      return [{ type: "part-delta", messageId: ctx.current.messageId, partIndex, delta }];
    }
    default:
      return [];
  }
}

function reconcileAssistant(raw: any, ctx: TurnContext): AgentEvent[] {
  const events: AgentEvent[] = [];
  if (!ctx.current) events.push(...openMessage(ctx));
  const cur = ctx.current!;
  const content: any[] = Array.isArray(raw?.message?.content) ? raw.message.content : [];
  const reconciled: AgentPart[] = [];
  for (const block of content) {
    if (block.type === "text") reconciled.push({ type: "text", text: block.text ?? "" });
    else if (block.type === "thinking") reconciled.push({ type: "thinking", summary: block.thinking ?? "" });
    else if (block.type === "tool_use") {
      const part = toolCallPart(block);
      const partIndex = reconciled.length;
      ctx.tools.set(block.id, { messageId: cur.messageId, partIndex, startedAt: ctx.ids.now() });
      events.push({ type: "part-start", messageId: cur.messageId, partIndex, part });
      reconciled.push(part);
    }
  }
  cur.parts = reconciled;
  events.push(...closeMessage(ctx));
  return events;
}

function translateToolResults(raw: any, ctx: TurnContext): AgentEvent[] {
  const events: AgentEvent[] = [];
  const content: any[] = Array.isArray(raw?.message?.content) ? raw.message.content : [];
  for (const block of content) {
    if (block.type !== "tool_result") continue;
    const loc = ctx.tools.get(block.tool_use_id);
    if (!loc) continue;
    ctx.tools.delete(block.tool_use_id);
    const output = textFromResultContent(block.content).slice(0, MAX_TOOL_OUTPUT);
    events.push({
      type: "part-end",
      messageId: loc.messageId,
      partIndex: loc.partIndex,
      part: {
        // The session manager patches the persisted part; the adapter reports the terminal fields.
        type: "tool-call",
        toolUseId: block.tool_use_id,
        toolName: "",
        title: "",
        status: block.is_error ? "error" : "ok",
        output,
        durationMs: ctx.ids.now() - loc.startedAt,
      },
    });
  }
  return events;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const claudeAdapter: AgentProviderAdapter = {
  id: "claude",

  capabilities(worktreePath: string): AgentCapabilities {
    return {
      models: MODELS,
      reasoningLevels: REASONING,
      slashCommands: [
        { name: "/compact", description: "Compact the conversation context" },
        ...scanSlashCommands(join(homedir(), ".claude", "commands")),
        ...scanSlashCommands(join(worktreePath, ".claude", "commands")),
      ],
      supportsInterrupt: true,
      supportsConversationRewind: true,
    };
  },

  buildSpawn(opts: SpawnOpts): string[] {
    const cmd = [
      "claude",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-mode", "bypassPermissions",
      "--max-turns", "1000",
    ];
    if (opts.model && opts.model !== "default") cmd.push("--model", opts.model);
    if (opts.reasoningLevel && opts.reasoningLevel !== "default") cmd.push("--effort", opts.reasoningLevel);
    if (opts.resumeSessionId) cmd.push("--resume", opts.resumeSessionId);
    return cmd;
  },

  encodeUserMessage(parts: AgentPart[]): string {
    const text = parts
      .map((p) => {
        if (p.type === "text") return p.text;
        if (p.type === "attachment") return `[Attached file: ${p.path}]`;
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
    return JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
  },

  encodeInterrupt(requestId: string): string | null {
    return JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype: "interrupt" } });
  },

  translate(line: string, ctx: TurnContext): AgentEvent[] {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line);
    } catch {
      ctx.unknownLines += 1;
      return [];
    }
    switch (raw.type) {
      case "system": {
        if (raw.subtype !== "init") return [];
        return [{ type: "session-meta", providerSessionId: String(raw.session_id ?? ""), model: String(raw.model ?? "") }];
      }
      case "stream_event":
        return translateStreamEvent((raw as { event?: unknown }).event, ctx);
      case "assistant":
        return reconcileAssistant(raw, ctx);
      case "user":
        return translateToolResults(raw, ctx);
      case "result": {
        const events: AgentEvent[] = [...closeMessage(ctx)];
        if (raw.is_error) {
          events.push({ type: "error", message: String((raw as { result?: unknown }).result ?? "agent run failed"), recoverable: true });
        }
        const usage = (raw.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
        events.push({
          type: "turn-end",
          turnId: ctx.turnId,
          usage: {
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            ...(typeof raw.total_cost_usd === "number" ? { costUsd: raw.total_cost_usd } : {}),
            durationMs: typeof raw.duration_ms === "number" ? raw.duration_ms : 0,
          },
        });
        return events;
      }
      case "control_response":
      case "control_request":
        return [];
      default:
        ctx.unknownLines += 1;
        return [];
    }
  },
};
```

Note on `fileChangesFor`'s return type: declare it plainly as `{ fileChanges?: AgentFileChange[] }` (the inline conditional shown in the sketch above is noise — use the simple form).

- [ ] **Step 5: Run tests**

Run: `bun test sidecar/agent/providers/claude.test.ts`
Expected: ALL PASS. Fix mapping bugs until green — the fixtures are the contract.

- [ ] **Step 6: Record a real fixture (best-effort, keep as extra test if it works)**

```bash
echo 'say the word hello and nothing else' | claude -p --output-format stream-json --verbose --include-partial-messages > /private/tmp/claude-501/-Users-malharujawane--maverick-maverick-worktrees-feature-agent-ui/6c3000e5-0465-4f4e-939c-717199e61016/scratchpad/claude-stream-fixture.ndjson || true
head -c 2000 /private/tmp/claude-501/-Users-malharujawane--maverick-maverick-worktrees-feature-agent-ui/6c3000e5-0465-4f4e-939c-717199e61016/scratchpad/claude-stream-fixture.ndjson
```

If the installed CLI's line shapes differ from the fixtures (field renames, missing `stream_event`), update the adapter AND the synthetic fixtures to match reality, and note the minimum CLI version in a comment on `claudeAdapter`. Also verify `claude --help | grep -E "effort|include-partial"` — if `--effort` is absent, replace it in `buildSpawn` with `--max-thinking-tokens` mapping low→4000, medium→16000, high→32000 (and update the buildSpawn test).

- [ ] **Step 7: Commit**

```bash
git add sidecar/agent/ sidecar/types.ts src/lib/ipc.ts
git commit -m "feat(sidecar): unified agent protocol types + Claude stream-json adapter

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Checkpoint manager (git snapshot/restore on a hidden ref)

**Files:**
- Create: `sidecar/agent/checkpoints.ts`
- Test: `sidecar/agent/checkpoints.test.ts`

**Interfaces:**
- Produces (consumed by Task 6):
  - `class CheckpointManager { snapshot(worktreePath, sessionId): Promise<string>; restore(worktreePath, sha): Promise<void>; dropRef(worktreePath, sessionId): Promise<void> }`

- [ ] **Step 1: Failing tests against real temp git repos**

`sidecar/agent/checkpoints.test.ts`:

```ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CheckpointManager } from "./checkpoints";

async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  if (proc.exitCode !== 0) throw new Error(await new Response(proc.stderr).text());
  return out.trim();
}

let repo: string;
const cp = new CheckpointManager();

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "mvck-cp-"));
  await git(repo, "init", "-b", "main");
  await git(repo, "config", "user.email", "t@t.t");
  await git(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "a.txt"), "one\n");
  await git(repo, "add", "-A");
  await git(repo, "commit", "-m", "init");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("CheckpointManager", () => {
  test("snapshot captures tracked modifications, untracked files, and deletions; restore reverts all three", async () => {
    writeFileSync(join(repo, "a.txt"), "one\nmodified\n");
    writeFileSync(join(repo, "untracked.txt"), "new\n");
    const sha = await cp.snapshot(repo, "sess1");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);

    // Mutate everything after the snapshot.
    writeFileSync(join(repo, "a.txt"), "trashed\n");
    rmSync(join(repo, "untracked.txt"));
    writeFileSync(join(repo, "later.txt"), "post-snapshot file\n");
    mkdirSync(join(repo, "newdir"));
    writeFileSync(join(repo, "newdir", "x.txt"), "x\n");

    await cp.restore(repo, sha);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("one\nmodified\n");
    expect(readFileSync(join(repo, "untracked.txt"), "utf8")).toBe("new\n");
    expect(existsSync(join(repo, "later.txt"))).toBe(false);
    expect(existsSync(join(repo, "newdir"))).toBe(false);
    // HEAD/branch untouched; snapshot invisible to normal git log.
    expect(await git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });

  test("snapshot does not disturb the working tree, index, or status", async () => {
    writeFileSync(join(repo, "a.txt"), "one\ndirty\n");
    const statusBefore = await git(repo, "status", "--porcelain");
    await cp.snapshot(repo, "sess1");
    expect(await git(repo, "status", "--porcelain")).toBe(statusBefore);
  });

  test("snapshots stack on the session ref and dropRef removes it", async () => {
    const sha1 = await cp.snapshot(repo, "sess1");
    writeFileSync(join(repo, "b.txt"), "b\n");
    const sha2 = await cp.snapshot(repo, "sess1");
    expect(sha1).not.toBe(sha2);
    expect(await git(repo, "rev-parse", "refs/maverick/checkpoints/sess1")).toBe(sha2);
    await cp.dropRef(repo, "sess1");
    await expect(git(repo, "rev-parse", "refs/maverick/checkpoints/sess1")).rejects.toThrow();
  });
});
```

Run: `bun test sidecar/agent/checkpoints.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement**

`sidecar/agent/checkpoints.ts`:

```ts
import { join } from "path";
import { tmpdir } from "os";
import { rmSync } from "fs";
import { HARDENED_ENV, toolAugmentedPath } from "../deps";

async function run(cmd: string[], cwd: string, env?: Record<string, string>): Promise<string> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...HARDENED_ENV, PATH: toolAugmentedPath(), ...env },
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  if (proc.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed: ${err || out}`);
  return out.trim();
}

export class CheckpointManager {
  /**
   * Commit the full working tree (tracked + untracked, .gitignore respected)
   * to refs/maverick/checkpoints/<sessionId> WITHOUT touching HEAD, the real
   * index, or the working tree. Uses a throwaway GIT_INDEX_FILE.
   */
  async snapshot(worktreePath: string, sessionId: string): Promise<string> {
    const tmpIndex = join(tmpdir(), `maverick-cpidx-${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const env = { GIT_INDEX_FILE: tmpIndex };
    try {
      await run(["git", "add", "-A"], worktreePath, env);
      const tree = await run(["git", "write-tree"], worktreePath, env);
      let parent: string | null = null;
      try {
        parent = await run(["git", "rev-parse", "--verify", "HEAD"], worktreePath);
      } catch {
        /* unborn branch — parentless checkpoint commit */
      }
      const sha = await run(
        ["git", "commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", "maverick agent checkpoint"],
        worktreePath
      );
      await run(["git", "update-ref", `refs/maverick/checkpoints/${sessionId}`, sha], worktreePath);
      return sha;
    } finally {
      rmSync(tmpIndex, { force: true });
    }
  }

  /**
   * Make the working tree exactly match the snapshot: read-tree sets the index
   * to the snapshot, checkout-index writes every file, clean drops files that
   * did not exist at snapshot time (ignored files survive), and the final
   * mixed reset returns the index to HEAD so git status stays conventional.
   */
  async restore(worktreePath: string, sha: string): Promise<void> {
    await run(["git", "read-tree", sha], worktreePath);
    await run(["git", "checkout-index", "-f", "-a"], worktreePath);
    await run(["git", "clean", "-fd"], worktreePath);
    await run(["git", "reset", "-q"], worktreePath);
  }

  async dropRef(worktreePath: string, sessionId: string): Promise<void> {
    try {
      await run(["git", "update-ref", "-d", `refs/maverick/checkpoints/${sessionId}`], worktreePath);
    } catch {
      /* ref never created — nothing to drop */
    }
  }
}
```

- [ ] **Step 3: Run tests**

Run: `bun test sidecar/agent/checkpoints.test.ts`
Expected: ALL PASS. If `checkout-index` leaves stale directories on some git versions, the `clean -fd` covers them; do not add `-x` (it would delete ignored build artifacts like node_modules).

- [ ] **Step 4: Commit**

```bash
git add sidecar/agent/checkpoints.ts sidecar/agent/checkpoints.test.ts
git commit -m "feat(sidecar): git checkpoint snapshot/restore on hidden refs for agent rewind

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
### Task 6: Claude session-file fork (conversation rewind)

**Files:**
- Create: `sidecar/agent/claude-session-file.ts`
- Test: `sidecar/agent/claude-session-file.test.ts`

**Interfaces:**
- Produces (consumed by Task 7):
  - `claudeProjectDir(worktreePath: string, home?: string): string` — `~/.claude/projects/<slug>` where slug = worktreePath with every non-alphanumeric char replaced by `-`
  - `sessionFileLineCount(worktreePath: string, providerSessionId: string, home?: string): number` — 0 when missing
  - `forkSessionFile(worktreePath: string, providerSessionId: string, lineCount: number, newId: string, home?: string): boolean` — writes a truncated copy as `<newId>.jsonl` with per-line `sessionId` rewritten; false when the source is missing/short

This is the spec's flagged riskiest piece. It is deliberately isolated in one file so a CLI format change breaks one module. Every function takes an injectable `home` for tests.

- [ ] **Step 1: Failing tests**

`sidecar/agent/claude-session-file.test.ts`:

```ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { claudeProjectDir, sessionFileLineCount, forkSessionFile } from "./claude-session-file";

let home: string;
const WT = "/Users/me/proj/wt-1";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "mvck-home-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function seedSession(id: string, lines: string[]): string {
  const dir = claudeProjectDir(WT, home);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${id}.jsonl`);
  writeFileSync(p, lines.join("\n") + "\n");
  return p;
}

describe("claude session files", () => {
  test("claudeProjectDir slugs the worktree path", () => {
    expect(claudeProjectDir(WT, home)).toBe(join(home, ".claude", "projects", "-Users-me-proj-wt-1"));
  });

  test("sessionFileLineCount counts non-empty lines; 0 when missing", () => {
    expect(sessionFileLineCount(WT, "nope", home)).toBe(0);
    seedSession("s1", [JSON.stringify({ sessionId: "s1", a: 1 }), JSON.stringify({ sessionId: "s1", a: 2 })]);
    expect(sessionFileLineCount(WT, "s1", home)).toBe(2);
  });

  test("forkSessionFile writes a truncated copy with rewritten sessionId", () => {
    seedSession("s1", [
      JSON.stringify({ sessionId: "s1", turn: 1 }),
      JSON.stringify({ sessionId: "s1", turn: 2 }),
      JSON.stringify({ sessionId: "s1", turn: 3 }),
    ]);
    expect(forkSessionFile(WT, "s1", 2, "fork1", home)).toBe(true);
    const forked = readFileSync(join(claudeProjectDir(WT, home), "fork1.jsonl"), "utf8").trim().split("\n");
    expect(forked).toHaveLength(2);
    expect(forked.map((l) => JSON.parse(l))).toEqual([
      { sessionId: "fork1", turn: 1 },
      { sessionId: "fork1", turn: 2 },
    ]);
  });

  test("forkSessionFile returns false when source is missing or lineCount is 0", () => {
    expect(forkSessionFile(WT, "ghost", 3, "f", home)).toBe(false);
    seedSession("s2", [JSON.stringify({ sessionId: "s2" })]);
    expect(forkSessionFile(WT, "s2", 0, "f2", home)).toBe(false);
    expect(existsSync(join(claudeProjectDir(WT, home), "f2.jsonl"))).toBe(false);
  });
});
```

Run: `bun test sidecar/agent/claude-session-file.test.ts` → FAIL.

- [ ] **Step 2: Implement**

`sidecar/agent/claude-session-file.ts`:

```ts
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// The claude CLI stores each session as
// ~/.claude/projects/<cwd-slug>/<session-id>.jsonl where the slug replaces
// every non-alphanumeric character of the absolute cwd with "-". This coupling
// is version-checked at runtime: all functions degrade to "no fork" (fresh
// provider session) when the layout doesn't match.
export function claudeProjectDir(worktreePath: string, home: string = homedir()): string {
  const slug = worktreePath.replace(/[^a-zA-Z0-9]/g, "-");
  return join(home, ".claude", "projects", slug);
}

function sessionPath(worktreePath: string, providerSessionId: string, home?: string): string {
  return join(claudeProjectDir(worktreePath, home), `${providerSessionId}.jsonl`);
}

export function sessionFileLineCount(worktreePath: string, providerSessionId: string, home?: string): number {
  const p = sessionPath(worktreePath, providerSessionId, home);
  if (!existsSync(p)) return 0;
  try {
    return readFileSync(p, "utf8").split("\n").filter((l) => l.trim() !== "").length;
  } catch {
    return 0;
  }
}

export function forkSessionFile(
  worktreePath: string,
  providerSessionId: string,
  lineCount: number,
  newId: string,
  home?: string
): boolean {
  if (lineCount <= 0) return false;
  const src = sessionPath(worktreePath, providerSessionId, home);
  if (!existsSync(src)) return false;
  try {
    const lines = readFileSync(src, "utf8").split("\n").filter((l) => l.trim() !== "");
    if (lines.length < lineCount) return false;
    const truncated = lines.slice(0, lineCount).map((l) => {
      try {
        const obj = JSON.parse(l);
        if (typeof obj === "object" && obj !== null && "sessionId" in obj) obj.sessionId = newId;
        return JSON.stringify(obj);
      } catch {
        return l;
      }
    });
    writeFileSync(sessionPath(worktreePath, newId, home), truncated.join("\n") + "\n");
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Run tests**

Run: `bun test sidecar/agent/claude-session-file.test.ts` → ALL PASS.

- [ ] **Step 4: Live verification note (do it, record the outcome in the commit message)**

Check the real layout once: `ls ~/.claude/projects/ | head -3` and confirm a dir matching the slug pattern exists with `*.jsonl` inside. If the layout differs (e.g. nested by date), adjust `claudeProjectDir` + tests to reality. If `claude --resume <forked-id>` refuses forged files at runtime (Task 7's rewind test will reveal it in manual verification), the fallback is already wired: rewind proceeds files-only with a fresh provider session.

- [ ] **Step 5: Commit**

```bash
git add sidecar/agent/claude-session-file.ts sidecar/agent/claude-session-file.test.ts
git commit -m "feat(sidecar): claude session-file fork for conversation rewind

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: AgentSessionManager (process lifecycle, turn loop, queue, rewind)

**Files:**
- Create: `sidecar/agent/session-manager.ts`
- Test: `sidecar/agent/session-manager.test.ts`

**Interfaces:**
- Consumes: `SQLiteStore` (Task 2 methods), `adapterFor` (Task 4), `CheckpointManager` (Task 5), `claude-session-file` (Task 6), `Spawner`/`ManagedProc` (`sidecar/process-manager.ts:1-19`), `emit` (`sidecar/deps.ts:14`).
- Produces (consumed by Task 8):

```ts
class AgentSessionManager {
  constructor(opts: {
    store: SQLiteStore;
    notifier: Notifier;
    spawn?: Spawner;                    // test seam, defaults to defaultSpawner
    checkpoints?: CheckpointManager;
    ids?: IdProvider;                   // defaults to defaultIds
  });
  capabilities(workspaceId: string): AgentCapabilities;
  send(sessionId: string, parts: AgentPart[]): Promise<{ queued: boolean; turnId?: string }>;
  interrupt(sessionId: string): Promise<{ ok: true }>;
  queueRemove(sessionId: string, queuedId: string): { ok: true };
  setOptions(sessionId: string, opts: { model?: string; reasoningLevel?: string }): { ok: true };
  state(workspaceId: string): AgentSessionSnapshot;
  rewind(sessionId: string, messageId: string): Promise<{ ok: true }>;
  attachmentSave(sessionId: string, name: string, contentBase64: string): { path: string };
  disposeForWorkspace(workspaceId: string): void;   // kill proc, drop live state
}
```

Every emitted event goes through one private `emitEvent(workspaceId, sessionId, event)` that calls `emit(this.notifier, "agent.event", { workspaceId, sessionId, event })` — the Rust bridge turns that into Tauri event `agent:event` automatically (`src-tauri/src/lib.rs:23-30`), no Rust event code needed.

- [ ] **Step 1: Failing tests with a fake subprocess**

`sidecar/agent/session-manager.test.ts`. Build a controllable fake proc (same philosophy as the repo's existing fake-subprocess tests):

```ts
import { describe, expect, test, beforeEach } from "bun:test";
import { AgentSessionManager } from "./session-manager";
import { SQLiteStore } from "../sqlite-store";
import type { ManagedProc, Spawner } from "../process-manager";
import type { Notifier } from "../types";

class FakeProc implements ManagedProc {
  written: string[] = [];
  exitCode: number | null = null;
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  stdout = new ReadableStream<Uint8Array>({ start: (c) => (this.controller = c) });
  stderr = new ReadableStream<Uint8Array>({ start: () => {} });
  stdin = { write: (d: string | Uint8Array) => this.written.push(typeof d === "string" ? d : new TextDecoder().decode(d)) };
  private resolveExit!: (code: number) => void;
  exited = new Promise<number>((r) => (this.resolveExit = r));
  kill() { this.exit(143); }
  pushLine(obj: unknown) { this.controller.enqueue(new TextEncoder().encode(JSON.stringify(obj) + "\n")); }
  exit(code: number) { this.exitCode = code; this.controller.close(); this.resolveExit(code); }
}

let store: SQLiteStore;
let procs: FakeProc[];
let spawnedCmds: string[][];
let events: Array<{ method: string; params: { sessionId: string; event: { type: string } & Record<string, unknown> } }>;
let mgr: AgentSessionManager;
let ws: ReturnType<SQLiteStore["workspaceCreate"]>;

const spawn: Spawner = (cmd) => {
  const p = new FakeProc();
  procs.push(p);
  spawnedCmds.push(cmd);
  return p;
};
const notifier: Notifier = { write: (line) => events.push(JSON.parse(line)) };

function eventTypes(): string[] {
  return events.map((e) => e.params.event.type);
}
async function tick() { await new Promise((r) => setTimeout(r, 10)); }

beforeEach(() => {
  // Same in-memory + migrations-dir construction the sqlite-store tests use.
  store = new SQLiteStore(":memory:", new URL("../migrations", import.meta.url).pathname);
  procs = [];
  spawnedCmds = [];
  events = [];
  const fakeCheckpoints = { snapshot: async () => "cafebabe".repeat(5), restore: async () => {}, dropRef: async () => {} };
  mgr = new AgentSessionManager({ store, notifier, spawn, checkpoints: fakeCheckpoints as never });
  const project = store.projectAdd({ path: "/tmp/proj" });
  ws = store.workspaceCreate({ projectId: project.id, branch: "b", agentBackend: "claude", worktreePath: "/tmp/proj-wt", mode: "agent" });
});

describe("send", () => {
  test("first send spawns the CLI, persists + emits the user message, writes stdin, goes working", async () => {
    const res = await mgr.send(ws.sessionId, [{ type: "text", text: "hi" }]);
    expect(res.queued).toBe(false);
    expect(spawnedCmds).toHaveLength(1);
    expect(spawnedCmds[0][0]).toBe("claude");
    expect(procs[0].written).toHaveLength(1);
    expect(JSON.parse(procs[0].written[0]).type).toBe("user");
    const persisted = store.messagesList({ sessionId: ws.sessionId });
    expect(persisted).toHaveLength(1);
    expect(persisted[0].role).toBe("user");
    expect(eventTypes()).toEqual(expect.arrayContaining(["message-start", "message-end", "status"]));
    expect(mgr.state(ws.id).status).toBe("working");
  });

  test("a checkpoint row is recorded for the user message", async () => {
    await mgr.send(ws.sessionId, [{ type: "text", text: "hi" }]);
    const [m] = store.messagesList({ sessionId: ws.sessionId });
    const cp = store.checkpointByMessage(ws.sessionId, m.id);
    expect(cp?.gitSha).toBe("cafebabe".repeat(5));
  });

  test("assistant turn streams through and persists on message-end; turn-end returns to idle", async () => {
    await mgr.send(ws.sessionId, [{ type: "text", text: "hi" }]);
    procs[0].pushLine({ type: "system", subtype: "init", session_id: "prov1", model: "m" });
    procs[0].pushLine({ type: "assistant", message: { id: "m1", role: "assistant", content: [{ type: "text", text: "yo" }] }, session_id: "prov1" });
    procs[0].pushLine({ type: "result", subtype: "success", is_error: false, duration_ms: 5, usage: { input_tokens: 1, output_tokens: 2 }, session_id: "prov1" });
    await tick();
    expect(store.sessionMetaGet(ws.sessionId)?.providerSessionId).toBe("prov1");
    const msgs = store.messagesList({ sessionId: ws.sessionId });
    expect(msgs).toHaveLength(2);
    expect(JSON.parse(msgs[1].partsJson!)).toEqual([{ type: "text", text: "yo" }]);
    expect(mgr.state(ws.id).status).toBe("idle");
    expect(eventTypes()).toContain("turn-end");
  });

  test("send during an active turn queues; queue drains after turn-end", async () => {
    await mgr.send(ws.sessionId, [{ type: "text", text: "one" }]);
    const res2 = await mgr.send(ws.sessionId, [{ type: "text", text: "two" }]);
    expect(res2.queued).toBe(true);
    expect(mgr.state(ws.id).queue).toHaveLength(1);
    expect(eventTypes()).toContain("queue-updated");
    procs[0].pushLine({ type: "result", subtype: "success", is_error: false, duration_ms: 1, usage: { input_tokens: 1, output_tokens: 1 }, session_id: "p" });
    await tick();
    expect(procs[0].written).toHaveLength(2); // second turn auto-sent on same proc
    expect(mgr.state(ws.id).queue).toHaveLength(0);
    expect(mgr.state(ws.id).status).toBe("working");
  });

  test("queueRemove drops a queued message", async () => {
    await mgr.send(ws.sessionId, [{ type: "text", text: "one" }]);
    await mgr.send(ws.sessionId, [{ type: "text", text: "two" }]);
    const q = mgr.state(ws.id).queue[0];
    mgr.queueRemove(ws.sessionId, q.id);
    expect(mgr.state(ws.id).queue).toHaveLength(0);
  });
});

describe("options + respawn", () => {
  test("setOptions persists and forces a respawn with --resume on the next turn", async () => {
    await mgr.send(ws.sessionId, [{ type: "text", text: "one" }]);
    procs[0].pushLine({ type: "system", subtype: "init", session_id: "prov1", model: "m" });
    procs[0].pushLine({ type: "result", subtype: "success", is_error: false, duration_ms: 1, usage: { input_tokens: 1, output_tokens: 1 }, session_id: "prov1" });
    await tick();
    mgr.setOptions(ws.sessionId, { model: "claude-opus-4-8" });
    expect(store.sessionMetaGet(ws.sessionId)?.model).toBe("claude-opus-4-8");
    await mgr.send(ws.sessionId, [{ type: "text", text: "two" }]);
    expect(spawnedCmds).toHaveLength(2);
    expect(spawnedCmds[1]).toEqual(expect.arrayContaining(["--model", "claude-opus-4-8", "--resume", "prov1"]));
  });
});

describe("interrupt + exit + errors", () => {
  test("interrupt writes the control line", async () => {
    await mgr.send(ws.sessionId, [{ type: "text", text: "one" }]);
    await mgr.interrupt(ws.sessionId);
    expect(procs[0].written.some((l) => JSON.parse(l).type === "control_request")).toBe(true);
  });

  test("nonzero exit mid-turn emits error and flips status", async () => {
    await mgr.send(ws.sessionId, [{ type: "text", text: "one" }]);
    procs[0].exit(1);
    await tick();
    expect(mgr.state(ws.id).status).toBe("error");
    expect(eventTypes()).toContain("error");
  });

  test("send after a dead proc respawns transparently", async () => {
    await mgr.send(ws.sessionId, [{ type: "text", text: "one" }]);
    procs[0].exit(1);
    await tick();
    await mgr.send(ws.sessionId, [{ type: "text", text: "retry" }]);
    expect(spawnedCmds).toHaveLength(2);
    expect(mgr.state(ws.id).status).toBe("working");
  });
});

describe("rewind", () => {
  test("rewind restores checkpoint, truncates messages, clears provider session when fork impossible", async () => {
    await mgr.send(ws.sessionId, [{ type: "text", text: "one" }]);
    procs[0].pushLine({ type: "assistant", message: { id: "m1", role: "assistant", content: [{ type: "text", text: "reply" }] }, session_id: "p1" });
    procs[0].pushLine({ type: "result", subtype: "success", is_error: false, duration_ms: 1, usage: { input_tokens: 1, output_tokens: 1 }, session_id: "p1" });
    await tick();
    const [userMsg] = store.messagesList({ sessionId: ws.sessionId });
    await mgr.rewind(ws.sessionId, userMsg.id);
    expect(store.messagesList({ sessionId: ws.sessionId })).toHaveLength(0);
    // Fake worktree has no ~/.claude session file → fork fails → fresh provider session.
    expect(store.sessionMetaGet(ws.sessionId)?.providerSessionId).toBeNull();
    expect(mgr.state(ws.id).status).toBe("idle");
  });
});

describe("state + attachments", () => {
  test("state returns a snapshot for an untouched agent workspace", () => {
    const snap = mgr.state(ws.id);
    expect(snap).toMatchObject({ sessionId: ws.sessionId, workspaceId: ws.id, status: "idle", queue: [] });
  });

  test("attachmentSave writes under ~/.maverick/attachments/<sessionId>/ and sanitizes names", () => {
    const { path } = mgr.attachmentSave(ws.sessionId, "../evil name.txt", Buffer.from("hello").toString("base64"));
    expect(path).toContain(`/attachments/${ws.sessionId}/`);
    expect(path.endsWith("evil-name.txt")).toBe(true);
    expect(require("fs").readFileSync(path, "utf8")).toBe("hello");
  });
});
```

Run: `bun test sidecar/agent/session-manager.test.ts` → FAIL (module missing). Check how `sqlite-store.test.ts` actually constructs the store (`SQLiteStore` constructor signature is `(path?, migrationsDir?)` — confirm at `sidecar/sqlite-store.ts:95-104`) and match it.

- [ ] **Step 2: Implement**

`sidecar/agent/session-manager.ts`:

```ts
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { SQLiteStore } from "../sqlite-store";
import type {
  AgentCapabilities, AgentEvent, AgentPart, AgentRunStatus, AgentSessionSnapshot,
  IdProvider, Notifier, QueuedMessage,
} from "../types";
import { defaultIds, emit } from "../deps";
import { defaultSpawner, type ManagedProc, type Spawner } from "../process-manager";
import { adapterFor, type AgentProviderAdapter, type TurnContext } from "./provider";
import { CheckpointManager } from "./checkpoints";
import { forkSessionFile, sessionFileLineCount } from "./claude-session-file";

interface LiveSession {
  sessionId: string;
  workspaceId: string;
  worktreePath: string;
  backend: string;
  adapter: AgentProviderAdapter;
  proc: ManagedProc | null;
  status: AgentRunStatus;
  queue: QueuedMessage[];
  ctx: TurnContext | null;
  needsRespawn: boolean;
  generation: number; // guards stale read-loops after respawn
}

export interface AgentSessionManagerOptions {
  store: SQLiteStore;
  notifier: Notifier;
  spawn?: Spawner;
  checkpoints?: CheckpointManager;
  ids?: IdProvider;
  attachmentsRoot?: string;
}

export class AgentSessionManager {
  private store: SQLiteStore;
  private notifier: Notifier;
  private spawn: Spawner;
  private checkpoints: CheckpointManager;
  private ids: IdProvider;
  private attachmentsRoot: string;
  private live = new Map<string, LiveSession>();

  constructor(opts: AgentSessionManagerOptions) {
    this.store = opts.store;
    this.notifier = opts.notifier;
    this.spawn = opts.spawn ?? defaultSpawner;
    this.checkpoints = opts.checkpoints ?? new CheckpointManager();
    this.ids = opts.ids ?? defaultIds;
    this.attachmentsRoot = opts.attachmentsRoot ?? join(homedir(), ".maverick", "attachments");
  }

  private emitEvent(s: Pick<LiveSession, "workspaceId" | "sessionId">, event: AgentEvent): void {
    emit(this.notifier, "agent.event", { workspaceId: s.workspaceId, sessionId: s.sessionId, event });
  }

  private resolve(sessionId: string): LiveSession {
    const existing = this.live.get(sessionId);
    if (existing) return existing;
    const meta = this.store.sessionMetaGet(sessionId);
    if (!meta) throw new Error(`session ${sessionId} not found`);
    const ws = this.store.workspaceGet(meta.workspaceId);
    if (!ws) throw new Error(`workspace ${meta.workspaceId} not found`);
    const s: LiveSession = {
      sessionId,
      workspaceId: ws.id,
      worktreePath: ws.worktreePath,
      backend: ws.agentBackend,
      adapter: adapterFor(ws.agentBackend),
      proc: null,
      status: "idle",
      queue: [],
      ctx: null,
      needsRespawn: false,
      generation: 0,
    };
    this.live.set(sessionId, s);
    return s;
  }

  capabilities(workspaceId: string): AgentCapabilities {
    const ws = this.store.workspaceGet(workspaceId);
    if (!ws) throw new Error(`workspace ${workspaceId} not found`);
    return adapterFor(ws.agentBackend).capabilities(ws.worktreePath);
  }

  state(workspaceId: string): AgentSessionSnapshot {
    const ws = this.store.workspaceGet(workspaceId);
    if (!ws) throw new Error(`workspace ${workspaceId} not found`);
    const meta = this.store.sessionMetaGet(ws.sessionId);
    const liveState = this.live.get(ws.sessionId);
    return {
      sessionId: ws.sessionId,
      workspaceId,
      status: liveState?.status ?? "idle",
      queue: liveState?.queue ?? [],
      model: meta?.model ?? null,
      reasoningLevel: meta?.reasoningLevel ?? null,
      providerSessionId: meta?.providerSessionId ?? null,
    };
  }

  async send(sessionId: string, parts: AgentPart[]): Promise<{ queued: boolean; turnId?: string }> {
    const s = this.resolve(sessionId);
    if (s.status === "working") {
      const queued: QueuedMessage = { id: this.ids.uuid("q"), parts, createdAt: this.ids.now() };
      s.queue.push(queued);
      this.emitEvent(s, { type: "queue-updated", queue: [...s.queue] });
      return { queued: true };
    }
    const turnId = await this.startTurn(s, parts);
    return { queued: false, turnId };
  }

  private async startTurn(s: LiveSession, parts: AgentPart[]): Promise<string> {
    const turnId = this.ids.uuid("turn");
    const userMessageId = this.ids.uuid("umsg");
    const createdAt = this.ids.now();
    const meta = this.store.sessionMetaGet(s.sessionId);

    let gitSha = "";
    try {
      gitSha = await this.checkpoints.snapshot(s.worktreePath, s.sessionId);
    } catch (e) {
      // A checkpoint failure must not block the send — rewind for this turn is simply unavailable.
      console.error("[agent] checkpoint snapshot failed:", e);
    }
    if (gitSha) {
      this.store.checkpointCreate({
        id: this.ids.uuid("cp"),
        sessionId: s.sessionId,
        messageId: userMessageId,
        gitSha,
        providerSessionId: meta?.providerSessionId ?? null,
        providerLineCount: meta?.providerSessionId
          ? sessionFileLineCount(s.worktreePath, meta.providerSessionId)
          : 0,
        createdAt,
      });
    }

    const userMessage = {
      id: userMessageId,
      sessionId: s.sessionId,
      turnId,
      role: "user" as const,
      parts,
      createdAt,
    };
    this.store.agentMessageAppend({
      id: userMessageId,
      sessionId: s.sessionId,
      role: "user",
      content: parts.map((p) => (p.type === "text" ? p.text : "")).join("\n"),
      partsJson: JSON.stringify(parts),
      turnId,
      createdAt,
    });
    this.emitEvent(s, { type: "message-start", message: userMessage });
    this.emitEvent(s, { type: "message-end", message: userMessage });

    this.ensureProc(s);
    s.ctx = {
      sessionId: s.sessionId,
      turnId,
      ids: this.ids,
      current: null,
      tools: new Map(),
      unknownLines: 0,
    };
    s.proc!.stdin!.write(s.adapter.encodeUserMessage(parts) + "\n");
    this.setStatus(s, "working");
    return turnId;
  }

  private ensureProc(s: LiveSession): void {
    if (s.proc && s.proc.exitCode === null && !s.needsRespawn) return;
    if (s.proc && s.proc.exitCode === null) {
      try { s.proc.kill(); } catch { /* already gone */ }
    }
    const meta = this.store.sessionMetaGet(s.sessionId);
    const cmd = s.adapter.buildSpawn({
      worktreePath: s.worktreePath,
      model: meta?.model ?? null,
      reasoningLevel: meta?.reasoningLevel ?? null,
      resumeSessionId: meta?.providerSessionId ?? null,
    });
    s.proc = this.spawn(cmd, { cwd: s.worktreePath });
    s.needsRespawn = false;
    s.generation += 1;
    void this.readLoop(s, s.proc, s.generation);
  }

  private async readLoop(s: LiveSession, proc: ManagedProc, generation: number): Promise<void> {
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for await (const chunk of proc.stdout!) {
        if (s.generation !== generation) return;
        buf += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) this.handleLine(s, line);
        }
      }
    } catch (e) {
      console.error("[agent] stdout read failed:", e);
    }
    const code = await proc.exited;
    if (s.generation !== generation) return;
    s.proc = null;
    if (s.status === "working") {
      this.emitEvent(s, { type: "error", message: `agent process exited with code ${code}`, recoverable: true });
      this.setStatus(s, "error");
    }
  }

  private handleLine(s: LiveSession, line: string): void {
    if (!s.ctx) return;
    const events = s.adapter.translate(line, s.ctx);
    for (const event of events) {
      switch (event.type) {
        case "session-meta":
          this.store.sessionMetaSet(s.sessionId, { providerSessionId: event.providerSessionId });
          break;
        case "message-end":
          if (event.message.role === "assistant") {
            this.store.agentMessageAppend({
              id: event.message.id,
              sessionId: s.sessionId,
              role: "assistant",
              content: event.message.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n"),
              partsJson: JSON.stringify(event.message.parts),
              turnId: event.message.turnId,
              createdAt: event.message.createdAt,
            });
          }
          break;
        case "error":
          this.setStatus(s, "error");
          break;
        default:
          break;
      }
      this.emitEvent(s, event);
      if (event.type === "turn-end") this.finishTurn(s);
    }
  }

  private finishTurn(s: LiveSession): void {
    s.ctx = null;
    if (s.status !== "error") this.setStatus(s, "idle");
    const next = s.queue.shift();
    if (next) {
      this.emitEvent(s, { type: "queue-updated", queue: [...s.queue] });
      void this.startTurn(s, next.parts).catch((e) => {
        console.error("[agent] queued turn failed to start:", e);
        this.emitEvent(s, { type: "error", message: String(e), recoverable: true });
        this.setStatus(s, "error");
      });
    }
  }

  private setStatus(s: LiveSession, status: AgentRunStatus): void {
    if (s.status === status) return;
    s.status = status;
    this.emitEvent(s, { type: "status", status });
  }

  async interrupt(sessionId: string): Promise<{ ok: true }> {
    const s = this.resolve(sessionId);
    if (!s.proc || s.proc.exitCode !== null) return { ok: true };
    const line = s.adapter.encodeInterrupt(this.ids.uuid("ctl"));
    if (line) s.proc.stdin!.write(line + "\n");
    else s.proc.kill("SIGINT");
    return { ok: true };
  }

  queueRemove(sessionId: string, queuedId: string): { ok: true } {
    const s = this.resolve(sessionId);
    s.queue = s.queue.filter((q) => q.id !== queuedId);
    this.emitEvent(s, { type: "queue-updated", queue: [...s.queue] });
    return { ok: true };
  }

  setOptions(sessionId: string, opts: { model?: string; reasoningLevel?: string }): { ok: true } {
    const s = this.resolve(sessionId);
    this.store.sessionMetaSet(sessionId, {
      ...(opts.model !== undefined ? { model: opts.model } : {}),
      ...(opts.reasoningLevel !== undefined ? { reasoningLevel: opts.reasoningLevel } : {}),
    });
    s.needsRespawn = true;
    return { ok: true };
  }

  async rewind(sessionId: string, messageId: string): Promise<{ ok: true }> {
    const s = this.resolve(sessionId);
    const cp = this.store.checkpointByMessage(sessionId, messageId);
    if (!cp) throw new Error(`no checkpoint for message ${messageId}`);
    if (s.proc && s.proc.exitCode === null) {
      s.generation += 1; // detach the read loop before killing
      try { s.proc.kill(); } catch { /* already gone */ }
      s.proc = null;
    }
    s.ctx = null;
    s.queue = [];
    // Worktree first, DB second: never truncate history if files failed to restore.
    await this.checkpoints.restore(s.worktreePath, cp.gitSha);
    this.store.messagesTruncateFrom(sessionId, messageId);
    this.store.checkpointsTruncateFrom(sessionId, cp.createdAt);
    let providerSessionId: string | null = null;
    if (cp.providerSessionId && cp.providerLineCount > 0) {
      const forkId = crypto.randomUUID();
      if (forkSessionFile(s.worktreePath, cp.providerSessionId, cp.providerLineCount, forkId)) {
        providerSessionId = forkId;
      }
    }
    this.store.sessionMetaSet(sessionId, { providerSessionId });
    s.needsRespawn = true;
    this.setStatus(s, "idle");
    this.emitEvent(s, { type: "queue-updated", queue: [] });
    return { ok: true };
  }

  attachmentSave(sessionId: string, name: string, contentBase64: string): { path: string } {
    const dir = join(this.attachmentsRoot, sessionId);
    mkdirSync(dir, { recursive: true });
    const safe = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[-.]+/, "") || "attachment";
    const path = join(dir, safe);
    writeFileSync(path, Buffer.from(contentBase64, "base64"));
    return { path };
  }

  disposeForWorkspace(workspaceId: string): void {
    for (const [sessionId, s] of this.live) {
      if (s.workspaceId !== workspaceId) continue;
      s.generation += 1;
      if (s.proc && s.proc.exitCode === null) {
        try { s.proc.kill(); } catch { /* already gone */ }
      }
      void this.checkpoints.dropRef(s.worktreePath, sessionId).catch(() => {});
      this.live.delete(sessionId);
    }
  }
}
```

In the test, pass `attachmentsRoot` pointing into a temp dir instead of the real home (adjust the attachment test to construct `AgentSessionManager` with `attachmentsRoot` and assert against it — keep the `/attachments/<sessionId>/` path-shape assertion).

- [ ] **Step 3: Run tests**

Run: `bun test sidecar/agent/`
Expected: ALL PASS (adapter, checkpoints, session-file, session-manager).

- [ ] **Step 4: Commit**

```bash
git add sidecar/agent/session-manager.ts sidecar/agent/session-manager.test.ts
git commit -m "feat(sidecar): AgentSessionManager — turn loop, queue, interrupt, rewind, respawn

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: RPC wiring + Rust commands + tauri.ts wrappers

**Files:**
- Modify: `sidecar/rpc-handlers.ts` (schemas, constructor, cases, teardown hook)
- Create: `src-tauri/src/commands/agent.rs`
- Modify: `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs` (invoke_handler list, ~line 249)
- Modify: `src/lib/tauri.ts`
- Test: `sidecar/rpc-handlers.test.ts`

**Interfaces:**
- Consumes: `AgentSessionManager` (Task 7).
- Produces (consumed by Tasks 9-15) — `src/lib/tauri.ts` exports:

```ts
agentCapabilities(workspaceId: string): Promise<AgentCapabilities>
agentSend(sessionId: string, parts: AgentPart[]): Promise<{ queued: boolean; turnId?: string }>
agentInterrupt(sessionId: string): Promise<{ ok: true }>
agentQueueRemove(sessionId: string, queuedId: string): Promise<{ ok: true }>
agentSetOptions(sessionId: string, opts: { model?: string; reasoningLevel?: string }): Promise<{ ok: true }>
agentState(workspaceId: string): Promise<AgentSessionSnapshot>
agentRewind(sessionId: string, messageId: string): Promise<{ ok: true }>
agentAttachmentSave(sessionId: string, name: string, contentBase64: string): Promise<{ path: string }>
onAgentEvent(cb: (p: AgentEventPayload) => void): Promise<UnlistenFn>   // listens "agent:event"
```

- [ ] **Step 1: Sidecar failing test**

`sidecar/rpc-handlers.test.ts` (existing harness; give `RpcHandlers` a fake agents manager via options):

```ts
test("agent.* methods dispatch to the session manager", async () => {
  const calls: string[] = [];
  const fakeAgents = {
    capabilities: (id: string) => { calls.push(`cap:${id}`); return { models: [], reasoningLevels: [], slashCommands: [], supportsInterrupt: true, supportsConversationRewind: true }; },
    send: async (id: string) => { calls.push(`send:${id}`); return { queued: false, turnId: "t" }; },
    interrupt: async (id: string) => { calls.push(`int:${id}`); return { ok: true }; },
    queueRemove: (id: string, q: string) => { calls.push(`qr:${id}:${q}`); return { ok: true }; },
    setOptions: (id: string) => { calls.push(`opt:${id}`); return { ok: true }; },
    state: (id: string) => { calls.push(`state:${id}`); return { sessionId: "s", workspaceId: id, status: "idle", queue: [], model: null, reasoningLevel: null, providerSessionId: null }; },
    rewind: async (id: string, m: string) => { calls.push(`rw:${id}:${m}`); return { ok: true }; },
    attachmentSave: (id: string, n: string) => { calls.push(`att:${id}:${n}`); return { path: "/x" }; },
    disposeForWorkspace: () => {},
  };
  const h = makeHandlers({ agents: fakeAgents as never }); // extend the file's factory to pass opts.agents
  await h.handle("agent.capabilities", { workspaceId: "w1" });
  await h.handle("agent.send", { sessionId: "s1", parts: [{ type: "text", text: "hi" }] });
  await h.handle("agent.interrupt", { sessionId: "s1" });
  await h.handle("agent.queueRemove", { sessionId: "s1", queuedId: "q1" });
  await h.handle("agent.setOptions", { sessionId: "s1", model: "m" });
  await h.handle("agent.state", { workspaceId: "w1" });
  await h.handle("agent.rewind", { sessionId: "s1", messageId: "m1" });
  await h.handle("agent.attachmentSave", { sessionId: "s1", name: "a.txt", contentBase64: "aGk=" });
  expect(calls).toEqual(["cap:w1", "send:s1", "int:s1", "qr:s1:q1", "opt:s1", "state:w1", "rw:s1:m1", "att:s1:a.txt"]);
});
```

Run: `bun test sidecar/rpc-handlers.test.ts` → FAIL (unknown method).

- [ ] **Step 2: Sidecar implementation**

In `sidecar/rpc-handlers.ts`:
- Import + field + constructor wiring (`RpcHandlersOptions` gains `agents?: AgentSessionManager`):

```ts
import { AgentSessionManager } from "./agent/session-manager";
// field:
readonly agents: AgentSessionManager;
// constructor (after this.notifier is assigned — the manager needs it):
this.agents = opts.agents ?? new AgentSessionManager({ store: this.store, notifier: this.notifier });
```

Note: `this.notifier` is currently assigned mid-constructor (`rpc-handlers.ts:359`); place the `agents` assignment after it.

- Schemas:

```ts
  agentCapabilities: z.object({ workspaceId: z.string() }),
  agentSend: z.object({ sessionId: z.string(), parts: z.array(z.record(z.string(), z.unknown())) }),
  agentInterrupt: z.object({ sessionId: z.string() }),
  agentQueueRemove: z.object({ sessionId: z.string(), queuedId: z.string() }),
  agentSetOptions: z.object({
    sessionId: z.string(),
    model: nullishOptional(z.string()),
    reasoningLevel: nullishOptional(z.string()),
  }),
  agentState: z.object({ workspaceId: z.string() }),
  agentRewind: z.object({ sessionId: z.string(), messageId: z.string() }),
  agentAttachmentSave: z.object({ sessionId: z.string(), name: z.string(), contentBase64: z.string() }),
```

- Cases (next to the `messages.*` cases):

```ts
      case "agent.capabilities": {
        const p = Schemas.agentCapabilities.parse(params);
        return this.agents.capabilities(p.workspaceId);
      }
      case "agent.send": {
        const p = Schemas.agentSend.parse(params);
        return this.agents.send(p.sessionId, p.parts as never);
      }
      case "agent.interrupt": {
        const p = Schemas.agentInterrupt.parse(params);
        return this.agents.interrupt(p.sessionId);
      }
      case "agent.queueRemove": {
        const p = Schemas.agentQueueRemove.parse(params);
        return this.agents.queueRemove(p.sessionId, p.queuedId);
      }
      case "agent.setOptions": {
        const p = Schemas.agentSetOptions.parse(params);
        return this.agents.setOptions(p.sessionId, { model: p.model, reasoningLevel: p.reasoningLevel });
      }
      case "agent.state": {
        const p = Schemas.agentState.parse(params);
        return this.agents.state(p.workspaceId);
      }
      case "agent.rewind": {
        const p = Schemas.agentRewind.parse(params);
        return this.agents.rewind(p.sessionId, p.messageId);
      }
      case "agent.attachmentSave": {
        const p = Schemas.agentAttachmentSave.parse(params);
        return this.agents.attachmentSave(p.sessionId, p.name, p.contentBase64);
      }
```

- Teardown hook — first line of `teardownWorkspace` (`rpc-handlers.ts:388`):

```ts
    this.agents.disposeForWorkspace(workspaceId);
```

Run: `bun test sidecar/rpc-handlers.test.ts` → PASS.

- [ ] **Step 3: Rust commands**

`src-tauri/src/commands/agent.rs`:

```rust
use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn agent_capabilities(state: State<'_, AppState>, workspace_id: String) -> Result<Value, String> {
    state
        .sidecar
        .request("agent.capabilities", json!({ "workspaceId": workspace_id }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_send(state: State<'_, AppState>, session_id: String, parts: Value) -> Result<Value, String> {
    state
        .sidecar
        .request("agent.send", json!({ "sessionId": session_id, "parts": parts }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_interrupt(state: State<'_, AppState>, session_id: String) -> Result<Value, String> {
    state
        .sidecar
        .request("agent.interrupt", json!({ "sessionId": session_id }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_queue_remove(state: State<'_, AppState>, session_id: String, queued_id: String) -> Result<Value, String> {
    state
        .sidecar
        .request("agent.queueRemove", json!({ "sessionId": session_id, "queuedId": queued_id }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_set_options(
    state: State<'_, AppState>,
    session_id: String,
    model: Option<String>,
    reasoning_level: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "agent.setOptions",
            json!({ "sessionId": session_id, "model": model, "reasoningLevel": reasoning_level }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_state(state: State<'_, AppState>, workspace_id: String) -> Result<Value, String> {
    state
        .sidecar
        .request("agent.state", json!({ "workspaceId": workspace_id }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_rewind(state: State<'_, AppState>, session_id: String, message_id: String) -> Result<Value, String> {
    state
        .sidecar
        .request("agent.rewind", json!({ "sessionId": session_id, "messageId": message_id }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_attachment_save(
    state: State<'_, AppState>,
    session_id: String,
    name: String,
    content_base64: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "agent.attachmentSave",
            json!({ "sessionId": session_id, "name": name, "contentBase64": content_base64 }),
        )
        .await
        .map_err(|e| e.to_string())
}
```

`src-tauri/src/commands/mod.rs`: add `pub mod agent;` and `pub use agent::{agent_attachment_save, agent_capabilities, agent_interrupt, agent_queue_remove, agent_rewind, agent_send, agent_set_options, agent_state};`

`src-tauri/src/lib.rs`: add those eight names to the `tauri::generate_handler![…]` list (near `workspace_create` at ~line 249).

Run: `cargo check --manifest-path src-tauri/Cargo.toml` → clean.

- [ ] **Step 4: tauri.ts wrappers**

Append to `src/lib/tauri.ts` (extend the type import block with `AgentCapabilities, AgentEventPayload, AgentPart, AgentSessionSnapshot`):

```ts
// Agent Mode

export async function agentCapabilities(workspaceId: string): Promise<AgentCapabilities> {
  return invoke("agent_capabilities", { workspaceId });
}

export async function agentSend(sessionId: string, parts: AgentPart[]): Promise<{ queued: boolean; turnId?: string }> {
  return invoke("agent_send", { sessionId, parts });
}

export async function agentInterrupt(sessionId: string): Promise<{ ok: true }> {
  return invoke("agent_interrupt", { sessionId });
}

export async function agentQueueRemove(sessionId: string, queuedId: string): Promise<{ ok: true }> {
  return invoke("agent_queue_remove", { sessionId, queuedId });
}

export async function agentSetOptions(
  sessionId: string,
  opts: { model?: string; reasoningLevel?: string }
): Promise<{ ok: true }> {
  return invoke("agent_set_options", { sessionId, model: opts.model, reasoningLevel: opts.reasoningLevel });
}

export async function agentState(workspaceId: string): Promise<AgentSessionSnapshot> {
  return invoke("agent_state", { workspaceId });
}

export async function agentRewind(sessionId: string, messageId: string): Promise<{ ok: true }> {
  return invoke("agent_rewind", { sessionId, messageId });
}

export async function agentAttachmentSave(
  sessionId: string,
  name: string,
  contentBase64: string
): Promise<{ path: string }> {
  return invoke("agent_attachment_save", { sessionId, name, contentBase64 });
}

export function onAgentEvent(callback: (payload: AgentEventPayload) => void): Promise<UnlistenFn> {
  return listen<AgentEventPayload>("agent:event", (e) => callback(e.payload));
}
```

- [ ] **Step 5: Build + full sidecar suite**

```bash
bun test sidecar/
cargo check --manifest-path src-tauri/Cargo.toml
bun run build
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add sidecar/rpc-handlers.ts sidecar/rpc-handlers.test.ts src-tauri/src/commands/ src-tauri/src/lib.rs src/lib/tauri.ts
git commit -m "feat(agent): agent.* RPC surface — sidecar handlers, Rust pass-throughs, typed wrappers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
### Task 9: Frontend agent store + global event listener (RAF delta coalescing, status bridge)

**Files:**
- Create: `src/state/agent-store.ts`, `src/lib/agent/agent-events.ts`
- Test: `src/state/agent-store.test.ts`, `src/lib/agent/agent-events.test.ts`

**Interfaces:**
- Consumes: `AgentEvent`/`AgentChatMessage`/`AgentSessionSnapshot` from `@/lib/ipc`, `onAgentEvent`/`agentState`/`messagesList` from `@/lib/tauri`, `useAgentStatusStore` (`src/hooks/useAgentStatus.ts:29`).
- Produces (consumed by Tasks 10-15):

```ts
// src/state/agent-store.ts
interface AgentSessionSlice {
  messages: AgentChatMessage[];
  status: AgentRunStatus;
  queue: QueuedMessage[];
  model: string | null;
  reasoningLevel: string | null;
  hydrated: boolean;
}
useAgentStore: zustand store {
  sessions: Record<string, AgentSessionSlice>;
  applyEvent(sessionId: string, event: AgentEvent): void;
  applyDeltas(sessionId: string, deltas: Array<{ messageId: string; partIndex: number; delta: string }>): void;
  hydrate(sessionId: string, messages: AgentChatMessage[], snap: AgentSessionSnapshot): void;
  setOptionsLocal(sessionId: string, opts: { model?: string; reasoningLevel?: string }): void;
  reset(sessionId: string): void;
}
emptySession(): AgentSessionSlice
// src/lib/agent/agent-events.ts
ensureAgentEventSubscription(): void   // idempotent module-level subscribe
hydrateAgentSession(workspaceId: string, sessionId: string): Promise<void>
parseStoredMessages(rows: Message[], sessionId: string): AgentChatMessage[]
__testing__ = { handlePayload, flushNow, reset }
```

- [ ] **Step 1: Failing store tests**

`src/state/agent-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore, emptySession } from "./agent-store";
import type { AgentChatMessage } from "@/lib/ipc";

const S = "sess1";
const msg = (id: string, role: "user" | "assistant" = "assistant"): AgentChatMessage => ({
  id, sessionId: S, turnId: "t1", role, parts: [], createdAt: 1,
});

beforeEach(() => useAgentStore.setState({ sessions: {} }));

describe("applyEvent", () => {
  it("message-start appends a streaming message; message-end replaces it with the final one", () => {
    const { applyEvent } = useAgentStore.getState();
    applyEvent(S, { type: "message-start", message: msg("m1") });
    expect(useAgentStore.getState().sessions[S].messages).toHaveLength(1);
    const final = { ...msg("m1"), parts: [{ type: "text" as const, text: "done" }] };
    applyEvent(S, { type: "message-end", message: final });
    const msgs = useAgentStore.getState().sessions[S].messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].parts).toEqual([{ type: "text", text: "done" }]);
  });

  it("part-start / part-end mutate the addressed part immutably", () => {
    const { applyEvent } = useAgentStore.getState();
    applyEvent(S, { type: "message-start", message: msg("m1") });
    applyEvent(S, { type: "part-start", messageId: "m1", partIndex: 0, part: { type: "text", text: "" } });
    const before = useAgentStore.getState().sessions[S].messages[0];
    applyEvent(S, {
      type: "part-end", messageId: "m1", partIndex: 0,
      part: { type: "tool-call", toolUseId: "t", toolName: "Bash", title: "run", status: "ok", output: "x" },
    });
    const after = useAgentStore.getState().sessions[S].messages[0];
    expect(after).not.toBe(before);
    expect(after.parts[0]).toMatchObject({ type: "tool-call", status: "ok" });
  });

  it("part-end for a tool-call merges terminal fields onto the existing part (adapter sends blank toolName)", () => {
    const { applyEvent } = useAgentStore.getState();
    applyEvent(S, { type: "message-start", message: msg("m1") });
    applyEvent(S, { type: "part-start", messageId: "m1", partIndex: 0, part: { type: "tool-call", toolUseId: "t", toolName: "Bash", title: "List files", detail: "ls", status: "running" } });
    applyEvent(S, { type: "part-end", messageId: "m1", partIndex: 0, part: { type: "tool-call", toolUseId: "t", toolName: "", title: "", status: "ok", output: "out", durationMs: 9 } });
    expect(useAgentStore.getState().sessions[S].messages[0].parts[0]).toEqual({
      type: "tool-call", toolUseId: "t", toolName: "Bash", title: "List files", detail: "ls", status: "ok", output: "out", durationMs: 9,
    });
  });

  it("status / queue-updated update the slice", () => {
    const { applyEvent } = useAgentStore.getState();
    applyEvent(S, { type: "status", status: "working" });
    applyEvent(S, { type: "queue-updated", queue: [{ id: "q1", parts: [], createdAt: 1 }] });
    expect(useAgentStore.getState().sessions[S]).toMatchObject({ status: "working", queue: [{ id: "q1" }] });
  });

  it("error event appends a system error message", () => {
    useAgentStore.getState().applyEvent(S, { type: "error", message: "boom", recoverable: true });
    const msgs = useAgentStore.getState().sessions[S].messages;
    expect(msgs.at(-1)).toMatchObject({ role: "system", parts: [{ type: "text", text: "boom" }] });
  });
});

describe("applyDeltas", () => {
  it("appends batched text to the addressed parts in one state write", () => {
    const { applyEvent, applyDeltas } = useAgentStore.getState();
    applyEvent(S, { type: "message-start", message: msg("m1") });
    applyEvent(S, { type: "part-start", messageId: "m1", partIndex: 0, part: { type: "text", text: "" } });
    applyDeltas(S, [
      { messageId: "m1", partIndex: 0, delta: "Hel" },
      { messageId: "m1", partIndex: 0, delta: "lo" },
    ]);
    expect(useAgentStore.getState().sessions[S].messages[0].parts[0]).toEqual({ type: "text", text: "Hello" });
  });

  it("thinking deltas extend the summary", () => {
    const { applyEvent, applyDeltas } = useAgentStore.getState();
    applyEvent(S, { type: "message-start", message: msg("m1") });
    applyEvent(S, { type: "part-start", messageId: "m1", partIndex: 0, part: { type: "thinking", summary: "" } });
    applyDeltas(S, [{ messageId: "m1", partIndex: 0, delta: "hmm" }]);
    expect(useAgentStore.getState().sessions[S].messages[0].parts[0]).toEqual({ type: "thinking", summary: "hmm" });
  });
});

describe("hydrate", () => {
  it("replaces messages and marks hydrated without clobbering a later streaming status", () => {
    useAgentStore.getState().hydrate(S, [msg("m1", "user")], {
      sessionId: S, workspaceId: "w1", status: "idle", queue: [], model: "claude-opus-4-8", reasoningLevel: null, providerSessionId: null,
    });
    expect(useAgentStore.getState().sessions[S]).toMatchObject({ hydrated: true, model: "claude-opus-4-8", status: "idle" });
    expect(useAgentStore.getState().sessions[S].messages).toHaveLength(1);
  });
});
```

Run: `bunx vitest run src/state/agent-store.test.ts` → FAIL.

- [ ] **Step 2: Implement the store**

`src/state/agent-store.ts`:

```ts
import { create } from "zustand";
import type {
  AgentChatMessage, AgentEvent, AgentPart, AgentRunStatus, AgentSessionSnapshot, QueuedMessage,
} from "@/lib/ipc";

export interface AgentSessionSlice {
  messages: AgentChatMessage[];
  status: AgentRunStatus;
  queue: QueuedMessage[];
  model: string | null;
  reasoningLevel: string | null;
  hydrated: boolean;
}

export function emptySession(): AgentSessionSlice {
  return { messages: [], status: "idle", queue: [], model: null, reasoningLevel: null, hydrated: false };
}

interface AgentStoreState {
  sessions: Record<string, AgentSessionSlice>;
  applyEvent: (sessionId: string, event: AgentEvent) => void;
  applyDeltas: (sessionId: string, deltas: Array<{ messageId: string; partIndex: number; delta: string }>) => void;
  hydrate: (sessionId: string, messages: AgentChatMessage[], snap: AgentSessionSnapshot) => void;
  setOptionsLocal: (sessionId: string, opts: { model?: string; reasoningLevel?: string }) => void;
  reset: (sessionId: string) => void;
}

function appendDelta(part: AgentPart, delta: string): AgentPart {
  if (part.type === "text") return { ...part, text: part.text + delta };
  if (part.type === "thinking") return { ...part, summary: part.summary + delta };
  return part;
}

function mergeToolPart(existing: AgentPart, incoming: AgentPart): AgentPart {
  if (existing.type !== "tool-call" || incoming.type !== "tool-call") return incoming;
  return {
    ...existing,
    status: incoming.status,
    ...(incoming.output !== undefined ? { output: incoming.output } : {}),
    ...(incoming.durationMs !== undefined ? { durationMs: incoming.durationMs } : {}),
    ...(incoming.fileChanges !== undefined ? { fileChanges: incoming.fileChanges } : {}),
  };
}

function withPart(
  messages: AgentChatMessage[],
  messageId: string,
  partIndex: number,
  update: (part: AgentPart | undefined) => AgentPart
): AgentChatMessage[] {
  return messages.map((m) => {
    if (m.id !== messageId) return m;
    const parts = [...m.parts];
    while (parts.length < partIndex) parts.push({ type: "text", text: "" });
    parts[partIndex] = update(parts[partIndex]);
    return { ...m, parts };
  });
}

function reduceEvent(slice: AgentSessionSlice, sessionId: string, event: AgentEvent): AgentSessionSlice {
  switch (event.type) {
    case "message-start": {
      if (slice.messages.some((m) => m.id === event.message.id)) return slice;
      return { ...slice, messages: [...slice.messages, event.message] };
    }
    case "message-end": {
      const exists = slice.messages.some((m) => m.id === event.message.id);
      return {
        ...slice,
        messages: exists
          ? slice.messages.map((m) => (m.id === event.message.id ? event.message : m))
          : [...slice.messages, event.message],
      };
    }
    case "part-start":
      return { ...slice, messages: withPart(slice.messages, event.messageId, event.partIndex, () => event.part) };
    case "part-end":
      return {
        ...slice,
        messages: withPart(slice.messages, event.messageId, event.partIndex, (p) =>
          p && p.type === "tool-call" && event.part.type === "tool-call" ? mergeToolPart(p, event.part) : event.part
        ),
      };
    case "status":
      return { ...slice, status: event.status };
    case "queue-updated":
      return { ...slice, queue: event.queue };
    case "error": {
      const errMsg: AgentChatMessage = {
        id: `err_${slice.messages.length}_${event.message.length}`,
        sessionId,
        turnId: "error",
        role: "system",
        parts: [{ type: "text", text: event.message }],
        createdAt: 0,
      };
      return { ...slice, messages: [...slice.messages, errMsg] };
    }
    case "session-meta":
    case "part-delta":
    case "turn-end":
    case "permission-request":
      return slice;
  }
}

export const useAgentStore = create<AgentStoreState>((set) => ({
  sessions: {},

  applyEvent: (sessionId, event) =>
    set((s) => {
      const slice = s.sessions[sessionId] ?? emptySession();
      const next = reduceEvent(slice, sessionId, event);
      if (next === slice) return s;
      return { sessions: { ...s.sessions, [sessionId]: next } };
    }),

  applyDeltas: (sessionId, deltas) =>
    set((s) => {
      const slice = s.sessions[sessionId] ?? emptySession();
      let messages = slice.messages;
      for (const d of deltas) {
        messages = withPart(messages, d.messageId, d.partIndex, (p) =>
          p ? appendDelta(p, d.delta) : { type: "text", text: d.delta }
        );
      }
      return { sessions: { ...s.sessions, [sessionId]: { ...slice, messages } } };
    }),

  hydrate: (sessionId, messages, snap) =>
    set((s) => {
      const slice = s.sessions[sessionId] ?? emptySession();
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...slice,
            messages,
            status: snap.status,
            queue: snap.queue,
            model: snap.model,
            reasoningLevel: snap.reasoningLevel,
            hydrated: true,
          },
        },
      };
    }),

  setOptionsLocal: (sessionId, opts) =>
    set((s) => {
      const slice = s.sessions[sessionId] ?? emptySession();
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...slice,
            ...(opts.model !== undefined ? { model: opts.model } : {}),
            ...(opts.reasoningLevel !== undefined ? { reasoningLevel: opts.reasoningLevel } : {}),
          },
        },
      };
    }),

  reset: (sessionId) =>
    set((s) => {
      const sessions = { ...s.sessions };
      delete sessions[sessionId];
      return { sessions };
    }),
}));
```

Run: `bunx vitest run src/state/agent-store.test.ts` → PASS.

- [ ] **Step 3: Event listener with RAF coalescing + status bridge — failing tests**

`src/lib/agent/agent-events.test.ts` (mock `@/lib/tauri`'s `onAgentEvent`, `agentState`, `messagesList`; use fake timers/RAF):

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { __testing__ } from "./agent-events";
import { useAgentStore } from "@/state/agent-store";
import { useAgentStatusStore } from "@/hooks/useAgentStatus";

vi.mock("@/lib/tauri", () => ({
  onAgentEvent: vi.fn().mockResolvedValue(() => {}),
  agentState: vi.fn(),
  messagesList: vi.fn(),
}));

const S = "sess1";
const W = "ws1";

beforeEach(() => {
  useAgentStore.setState({ sessions: {} });
  useAgentStatusStore.setState({ statuses: {} });
  __testing__.reset();
});

describe("handlePayload", () => {
  it("part-delta events buffer and flush together; non-delta events flush the buffer first (order preserved)", () => {
    __testing__.handlePayload({ workspaceId: W, sessionId: S, event: { type: "message-start", message: { id: "m1", sessionId: S, turnId: "t", role: "assistant", parts: [], createdAt: 1 } } });
    __testing__.handlePayload({ workspaceId: W, sessionId: S, event: { type: "part-start", messageId: "m1", partIndex: 0, part: { type: "text", text: "" } } });
    __testing__.handlePayload({ workspaceId: W, sessionId: S, event: { type: "part-delta", messageId: "m1", partIndex: 0, delta: "He" } });
    __testing__.handlePayload({ workspaceId: W, sessionId: S, event: { type: "part-delta", messageId: "m1", partIndex: 0, delta: "y" } });
    // deltas not applied yet (buffered)
    expect(useAgentStore.getState().sessions[S].messages[0].parts[0]).toEqual({ type: "text", text: "" });
    __testing__.flushNow();
    expect(useAgentStore.getState().sessions[S].messages[0].parts[0]).toEqual({ type: "text", text: "Hey" });
    // a message-end arriving with deltas pending flushes them BEFORE applying itself
    __testing__.handlePayload({ workspaceId: W, sessionId: S, event: { type: "part-delta", messageId: "m1", partIndex: 0, delta: "!" } });
    __testing__.handlePayload({ workspaceId: W, sessionId: S, event: { type: "message-end", message: { id: "m1", sessionId: S, turnId: "t", role: "assistant", parts: [{ type: "text", text: "Hey! (final)" }], createdAt: 1 } } });
    expect(useAgentStore.getState().sessions[S].messages[0].parts[0]).toEqual({ type: "text", text: "Hey! (final)" });
  });

  it("bridges status events to useAgentStatusStore keyed by workspaceId", () => {
    __testing__.handlePayload({ workspaceId: W, sessionId: S, event: { type: "status", status: "working" } });
    expect(useAgentStatusStore.getState().statuses[W]).toBe("working");
    __testing__.handlePayload({ workspaceId: W, sessionId: S, event: { type: "status", status: "error" } });
    expect(useAgentStatusStore.getState().statuses[W]).toBe("error");
    __testing__.handlePayload({ workspaceId: W, sessionId: S, event: { type: "status", status: "idle" } });
    expect(useAgentStatusStore.getState().statuses[W]).toBe("idle");
  });
});

describe("hydrateAgentSession", () => {
  it("fetches state + stored messages, parses parts_json, seeds the store", async () => {
    const { agentState, messagesList } = await import("@/lib/tauri");
    vi.mocked(agentState).mockResolvedValue({ sessionId: S, workspaceId: W, status: "idle", queue: [], model: null, reasoningLevel: null, providerSessionId: null });
    vi.mocked(messagesList).mockResolvedValue([
      { id: "m1", sessionId: S, role: "user", content: "hi", createdAt: 5, partsJson: JSON.stringify([{ type: "text", text: "hi" }]), turnId: "t1" },
      { id: "legacy", sessionId: S, role: "assistant", content: "old row without parts", createdAt: 6 },
    ]);
    const { hydrateAgentSession } = await import("./agent-events");
    await hydrateAgentSession(W, S);
    const msgs = useAgentStore.getState().sessions[S].messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0].parts).toEqual([{ type: "text", text: "hi" }]);
    expect(msgs[1].parts).toEqual([{ type: "text", text: "old row without parts" }]);
  });
});
```

Run: `bunx vitest run src/lib/agent/agent-events.test.ts` → FAIL.

- [ ] **Step 4: Implement the listener**

`src/lib/agent/agent-events.ts`:

```ts
import { onAgentEvent, agentState, messagesList } from "@/lib/tauri";
import type { AgentChatMessage, AgentEventPayload, Message } from "@/lib/ipc";
import { useAgentStore } from "@/state/agent-store";
import { useAgentStatusStore, type AgentStatus } from "@/hooks/useAgentStatus";

let subscribed = false;
let rafId: number | null = null;
const pendingDeltas = new Map<string, Array<{ messageId: string; partIndex: number; delta: string }>>();

function flushNow(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  for (const [sessionId, deltas] of pendingDeltas) {
    useAgentStore.getState().applyDeltas(sessionId, deltas);
  }
  pendingDeltas.clear();
}

function scheduleFlush(): void {
  if (rafId !== null) return;
  // 16ms coalescing window (same rule as PTY writes): high-frequency token
  // deltas collapse to one store write per frame.
  rafId = requestAnimationFrame(() => {
    rafId = null;
    flushNow();
  });
}

const STATUS_MAP: Record<string, AgentStatus> = { idle: "idle", working: "working", error: "error" };

function handlePayload(payload: AgentEventPayload): void {
  const { workspaceId, sessionId, event } = payload;
  if (event.type === "part-delta") {
    const list = pendingDeltas.get(sessionId) ?? [];
    list.push({ messageId: event.messageId, partIndex: event.partIndex, delta: event.delta });
    pendingDeltas.set(sessionId, list);
    scheduleFlush();
    return;
  }
  flushNow();
  if (event.type === "status") {
    useAgentStatusStore.getState().setStatus(workspaceId, STATUS_MAP[event.status] ?? "idle");
  }
  useAgentStore.getState().applyEvent(sessionId, event);
}

export function ensureAgentEventSubscription(): void {
  if (subscribed) return;
  subscribed = true;
  onAgentEvent(handlePayload).catch((err) => {
    subscribed = false;
    console.error("[agent-events] failed to subscribe", err);
  });
}

export function parseStoredMessages(rows: Message[], sessionId: string): AgentChatMessage[] {
  return rows.map((r) => {
    let parts: AgentChatMessage["parts"] | null = null;
    if (r.partsJson) {
      try {
        parts = JSON.parse(r.partsJson);
      } catch {
        parts = null;
      }
    }
    return {
      id: r.id,
      sessionId,
      turnId: r.turnId ?? r.id,
      role: r.role === "tool" ? "system" : r.role,
      parts: parts ?? [{ type: "text", text: r.content }],
      createdAt: r.createdAt,
    };
  });
}

export async function hydrateAgentSession(workspaceId: string, sessionId: string): Promise<void> {
  ensureAgentEventSubscription();
  const [snap, rows] = await Promise.all([agentState(workspaceId), messagesList(sessionId, 1000, 0)]);
  useAgentStore.getState().hydrate(sessionId, parseStoredMessages(rows, sessionId), snap);
}

export const __testing__ = { handlePayload, flushNow, reset: () => { pendingDeltas.clear(); if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; } } };
```

(`Message` in ipc.ts must carry `partsJson?`/`turnId?` — added in Task 3's mirror step; if missed, add them now to `src/lib/ipc.ts`'s `Message`.)

Run: `bunx vitest run src/lib/agent/agent-events.test.ts src/state/agent-store.test.ts` → ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/agent-store.ts src/state/agent-store.test.ts src/lib/agent/
git commit -m "feat(agent-ui): transcript store + agent:event listener with RAF delta coalescing

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Message part renderers (markdown, thinking, tool calls, file chips, turn grouping helpers)

**Files:**
- Create: `src/components/agent/ChatMarkdown.tsx`, `src/components/agent/parts/ThinkingRow.tsx`, `src/components/agent/parts/ToolCallRow.tsx`, `src/components/agent/parts/FileChangeChip.tsx`, `src/components/agent/parts/ActivitySection.tsx`, `src/components/agent/parts/UserMessage.tsx`, `src/components/agent/parts/AssistantTurn.tsx`, `src/lib/agent/turns.ts`
- Test: sibling `.test.tsx` per component + `src/lib/agent/turns.test.ts`

**Interfaces:**
- Consumes: `AgentChatMessage`, `AgentPart` from `@/lib/ipc`; `react-markdown` + `remark-gfm` (already deps, used in `src/panels/preview/MarkdownPreview.tsx`); `shiki` (already a dep).
- Produces (consumed by Task 11):
  - `groupIntoTurns(messages: AgentChatMessage[]): Turn[]` where `Turn = { turnId: string; user: AgentChatMessage | null; assistant: AgentChatMessage[]; system: AgentChatMessage[] }`
  - `<ChatMarkdown text={string} />`
  - `<UserMessage message onRewind?={(messageId) => void} />` (right-aligned bubble, attachment chips, ⋮ menu slot — rewind handler wired in Task 15)
  - `<AssistantTurn messages={AgentChatMessage[]} streaming={boolean} />` — activity collapse + final answer
  - `<FileChangeChip change={AgentFileChange} onOpen?={(path) => void} />`

- [ ] **Step 1: turn grouping — failing test**

`src/lib/agent/turns.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { groupIntoTurns } from "./turns";
import type { AgentChatMessage } from "@/lib/ipc";

const m = (id: string, turnId: string, role: AgentChatMessage["role"]): AgentChatMessage => ({
  id, turnId, role, sessionId: "s", parts: [], createdAt: 1,
});

describe("groupIntoTurns", () => {
  it("groups user + assistant messages by turnId preserving order", () => {
    const turns = groupIntoTurns([
      m("u1", "t1", "user"), m("a1", "t1", "assistant"), m("a2", "t1", "assistant"),
      m("u2", "t2", "user"), m("a3", "t2", "assistant"),
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ turnId: "t1", user: { id: "u1" } });
    expect(turns[0].assistant.map((x) => x.id)).toEqual(["a1", "a2"]);
  });

  it("system messages attach to the current turn; orphan assistants open a turn", () => {
    const turns = groupIntoTurns([m("a0", "t0", "assistant"), m("e1", "error", "system")]);
    expect(turns).toHaveLength(1);
    expect(turns[0].user).toBeNull();
    expect(turns[0].system.map((x) => x.id)).toEqual(["e1"]);
  });
});
```

`src/lib/agent/turns.ts`:

```ts
import type { AgentChatMessage } from "@/lib/ipc";

export interface Turn {
  turnId: string;
  user: AgentChatMessage | null;
  assistant: AgentChatMessage[];
  system: AgentChatMessage[];
}

export function groupIntoTurns(messages: AgentChatMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      turns.push({ turnId: msg.turnId, user: msg, assistant: [], system: [] });
      continue;
    }
    let turn = turns.at(-1);
    if (!turn || (msg.role === "assistant" && turn.turnId !== msg.turnId && msg.turnId !== "error")) {
      if (!turn || turn.turnId !== msg.turnId) {
        turn = { turnId: msg.turnId, user: null, assistant: [], system: [] };
        turns.push(turn);
      }
    }
    (msg.role === "assistant" ? turn.assistant : turn.system).push(msg);
  }
  return turns;
}
```

Run: `bunx vitest run src/lib/agent/turns.test.ts` → PASS (iterate until the two tests pass exactly).

- [ ] **Step 2: ChatMarkdown**

`src/components/agent/ChatMarkdown.tsx`:

```tsx
import { memo, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

let highlighterPromise: Promise<(code: string, lang: string) => string> | null = null;

function getHighlighter() {
  highlighterPromise ??= import("shiki").then(async (shiki) => {
    const h = await shiki.createHighlighter({ themes: ["github-dark-default"], langs: [] });
    return (code: string, lang: string) => {
      try {
        return h.codeToHtml(code, { lang, theme: "github-dark-default" });
      } catch {
        return "";
      }
    };
  });
  return highlighterPromise;
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    let cancelled = false;
    getHighlighter().then(async (highlight) => {
      const shiki = await import("shiki");
      try {
        await (await shiki.createHighlighter({ themes: [], langs: [] }), Promise.resolve());
      } catch { /* loaded */ }
      if (!cancelled) setHtml(highlight(code, lang));
    });
    return () => { cancelled = true; };
  }, [code, lang]);
  if (!html) {
    return (
      <pre className="overflow-x-auto rounded-md border border-border bg-muted p-3 text-[12px]">
        <code>{code}</code>
      </pre>
    );
  }
  return <div className="overflow-x-auto rounded-md border border-border text-[12px] [&_pre]:p-3" dangerouslySetInnerHTML={{ __html: html }} />;
}

export const ChatMarkdown = memo(function ChatMarkdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("mv-chatmarkdown min-w-0 space-y-3 text-[13px] leading-relaxed text-foreground", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: (props) => (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-[12px]" {...props} />
            </div>
          ),
          th: (props) => <th className="border-b border-border bg-muted px-3 py-2 text-left font-medium" {...props} />,
          td: (props) => <td className="border-b border-border px-3 py-2" {...props} />,
          code: ({ className: cls, children, ...rest }) => {
            const match = /language-(\w+)/.exec(cls ?? "");
            const text = String(children).replace(/\n$/, "");
            if (!match && !text.includes("\n")) {
              return (
                <code className="rounded-sm border border-border bg-muted px-1 py-0.5 text-[12px]" {...rest}>
                  {children}
                </code>
              );
            }
            return <CodeBlock code={text} lang={match?.[1] ?? "text"} />;
          },
          a: (props) => <a className="text-accent underline underline-offset-2" target="_blank" rel="noreferrer" {...props} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
```

Simplify the `CodeBlock` effect to a single `getHighlighter().then(...)` call (the sketch's double-import is noise); loading shiki languages lazily via `codeToHtml`'s on-demand `lang` may require `createHighlighter({ langs: ["typescript","javascript","json","bash","python","rust","tsx"] })` — pick that fixed set. Do NOT import from `@shikijs/monaco` here.

Test `src/components/agent/ChatMarkdown.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ChatMarkdown } from "./ChatMarkdown";

describe("ChatMarkdown", () => {
  it("renders gfm tables inside a horizontal-scroll container", () => {
    render(<ChatMarkdown text={"| a | b |\n| - | - |\n| 1 | 2 |"} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
  it("renders inline code and fenced code", () => {
    render(<ChatMarkdown text={"use `bun` here\n\n```ts\nconst x = 1;\n```"} />);
    expect(screen.getByText("bun")).toBeInTheDocument();
    expect(screen.getByText(/const x = 1/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Part rows**

`src/components/agent/parts/ThinkingRow.tsx`:

```tsx
import { useState } from "react";
import { Brain, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentPart } from "@/lib/ipc";

export function ThinkingRow({ part }: { part: Extract<AgentPart, { type: "thinking" }> }) {
  const [open, setOpen] = useState(false);
  const summary = part.summary.trim();
  if (!summary) return null;
  const firstLine = summary.split("\n")[0];
  return (
    <div className="mv-thinkingrow text-[12px] text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-muted"
      >
        <Brain className="h-3.5 w-3.5 shrink-0 opacity-70" />
        <span className="font-medium">Thinking</span>
        <span className={cn("truncate rounded-sm bg-muted px-1.5 py-0.5", open && "hidden")}>{firstLine}</span>
        <ChevronRight className={cn("ml-auto h-3 w-3 shrink-0 transition-transform duration-100", open && "rotate-90")} />
      </button>
      {open && <div className="whitespace-pre-wrap px-6 py-1">{summary}</div>}
    </div>
  );
}
```

`src/components/agent/parts/FileChangeChip.tsx`:

```tsx
import { FileText } from "lucide-react";
import type { AgentFileChange } from "@/lib/ipc";

export function FileChangeChip({ change, onOpen }: { change: AgentFileChange; onOpen?: (path: string) => void }) {
  const name = change.path.split("/").pop() ?? change.path;
  return (
    <button
      type="button"
      title={change.path}
      onClick={() => onOpen?.(change.path)}
      data-testid={`file-chip-${change.path}`}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 font-mono text-[11px] text-foreground transition-colors duration-100 hover:bg-muted"
    >
      <FileText className="h-3 w-3 shrink-0 opacity-70" />
      <span className="max-w-[220px] truncate">{name}</span>
      {change.additions > 0 && <span className="text-status-success">+{change.additions}</span>}
      {change.deletions > 0 && <span className="text-destructive">-{change.deletions}</span>}
    </button>
  );
}
```

If `text-status-success` doesn't exist in tokens, check `src/styles/tokens.css` for the success color token used by the git views (`grep -rn "success\|added" src/styles/tokens.css src/panels/git/`) and use that class; if none exists, add `--status-success` to tokens first per the design-system rule.

`src/components/agent/parts/ToolCallRow.tsx`:

```tsx
import { useState } from "react";
import { ChevronRight, CircleAlert, LoaderCircle, Terminal, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentPart } from "@/lib/ipc";
import { FileChangeChip } from "./FileChangeChip";

const TOOL_ICONS: Record<string, typeof Wrench> = { Bash: Terminal };

export function ToolCallRow({ part, onOpenFile }: { part: Extract<AgentPart, { type: "tool-call" }>; onOpenFile?: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICONS[part.toolName] ?? Wrench;
  return (
    <div className="mv-toolcallrow text-[12px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-muted-foreground hover:bg-muted"
      >
        {part.status === "running" ? (
          <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : part.status === "error" ? (
          <CircleAlert className="h-3.5 w-3.5 shrink-0 text-destructive" />
        ) : (
          <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
        )}
        <span className="truncate text-foreground">{part.title}</span>
        {part.detail && (
          <code className="truncate rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11px]">{part.detail}</code>
        )}
        <ChevronRight className={cn("ml-auto h-3 w-3 shrink-0 transition-transform duration-100", open && "rotate-90")} />
      </button>
      {part.fileChanges && part.fileChanges.length > 0 && (
        <div className="flex flex-wrap gap-1.5 py-1 pl-6">
          {part.fileChanges.map((c) => (
            <FileChangeChip key={c.path} change={c} onOpen={onOpenFile} />
          ))}
        </div>
      )}
      {open && part.output && (
        <pre className="ml-6 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted p-2 font-mono text-[11px] text-muted-foreground">
          {part.output}
        </pre>
      )}
    </div>
  );
}
```

`src/components/agent/parts/ActivitySection.tsx` — the "N tool calls, M messages" collapse:

```tsx
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentChatMessage, AgentPart } from "@/lib/ipc";
import { ThinkingRow } from "./ThinkingRow";
import { ToolCallRow } from "./ToolCallRow";
import { ChatMarkdown } from "../ChatMarkdown";

export function countActivity(messages: AgentChatMessage[]): { tools: number; texts: number } {
  let tools = 0;
  let texts = 0;
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type === "tool-call") tools += 1;
      if (p.type === "text" && p.text.trim()) texts += 1;
    }
  }
  return { tools, texts };
}

function PartView({ part, onOpenFile }: { part: AgentPart; onOpenFile?: (path: string) => void }) {
  switch (part.type) {
    case "text":
      return part.text.trim() ? <ChatMarkdown text={part.text} /> : null;
    case "thinking":
      return <ThinkingRow part={part} />;
    case "tool-call":
      return <ToolCallRow part={part} onOpenFile={onOpenFile} />;
    case "attachment":
      return null;
  }
}

export function ActivitySection({
  messages, streaming, onOpenFile,
}: { messages: AgentChatMessage[]; streaming: boolean; onOpenFile?: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const { tools, texts } = countActivity(messages);
  if (messages.length === 0) return null;
  const expanded = open || streaming;
  return (
    <div className="mv-activitysection flex flex-col gap-1">
      {!streaming && tools > 0 && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={expanded}
          data-testid="activity-toggle"
          className="flex items-center gap-1.5 self-start rounded-sm px-1 py-0.5 text-[12px] text-muted-foreground hover:bg-muted"
        >
          <ChevronRight className={cn("h-3 w-3 transition-transform duration-100", expanded && "rotate-90")} />
          {tools} tool {tools === 1 ? "call" : "calls"}, {texts} {texts === 1 ? "message" : "messages"}
        </button>
      )}
      {(expanded || tools === 0) && (
        <div className="flex flex-col gap-2">
          {messages.map((m) => (
            <div key={m.id} className="flex flex-col gap-2">
              {m.parts.map((p, i) => (
                <PartView key={`${m.id}-${i}`} part={p} onOpenFile={onOpenFile} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

`src/components/agent/parts/AssistantTurn.tsx` — activity collapsed, final answer always visible:

```tsx
import type { AgentChatMessage } from "@/lib/ipc";
import { ActivitySection } from "./ActivitySection";
import { ChatMarkdown } from "../ChatMarkdown";

function isFinalAnswer(m: AgentChatMessage): boolean {
  return m.parts.some((p) => p.type === "text" && p.text.trim()) && !m.parts.some((p) => p.type === "tool-call");
}

export function AssistantTurn({
  messages, streaming, onOpenFile,
}: { messages: AgentChatMessage[]; streaming: boolean; onOpenFile?: (path: string) => void }) {
  const last = messages.at(-1);
  const finalAnswer = !streaming && last && isFinalAnswer(last) ? last : null;
  const activity = finalAnswer ? messages.slice(0, -1) : messages;
  return (
    <div className="mv-assistantturn flex flex-col gap-2" data-testid="assistant-turn">
      <ActivitySection messages={activity} streaming={streaming} onOpenFile={onOpenFile} />
      {finalAnswer &&
        finalAnswer.parts.map((p, i) =>
          p.type === "text" && p.text.trim() ? <ChatMarkdown key={i} text={p.text} /> : null
        )}
    </div>
  );
}
```

`src/components/agent/parts/UserMessage.tsx`:

```tsx
import { Paperclip } from "lucide-react";
import type { AgentChatMessage } from "@/lib/ipc";

export function UserMessage({ message, actions }: { message: AgentChatMessage; actions?: React.ReactNode }) {
  const text = message.parts.filter((p) => p.type === "text").map((p) => (p.type === "text" ? p.text : "")).join("\n\n");
  const attachments = message.parts.filter((p) => p.type === "attachment");
  return (
    <div className="mv-usermessage group flex justify-end" data-testid={`user-message-${message.id}`}>
      <div className="flex max-w-[80%] flex-col items-end gap-1">
        {attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {attachments.map((a) =>
              a.type === "attachment" ? (
                <span key={a.path} title={a.path} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                  <Paperclip className="h-3 w-3" />
                  <span className="max-w-[200px] truncate">{a.name}</span>
                </span>
              ) : null
            )}
          </div>
        )}
        <div className="flex items-start gap-1">
          <span className="opacity-0 transition-opacity duration-100 group-hover:opacity-100">{actions}</span>
          <div className="whitespace-pre-wrap rounded-lg bg-muted px-4 py-2.5 text-[13px] text-foreground">{text}</div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Component tests**

One focused test file per component; the load-bearing ones:

`src/components/agent/parts/ActivitySection.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { ActivitySection } from "./ActivitySection";
import type { AgentChatMessage } from "@/lib/ipc";

const msg = (id: string, parts: AgentChatMessage["parts"]): AgentChatMessage => ({
  id, sessionId: "s", turnId: "t", role: "assistant", parts, createdAt: 1,
});
const toolPart = { type: "tool-call" as const, toolUseId: "t1", toolName: "Bash", title: "List files", detail: "ls", status: "ok" as const, output: "a\nb" };

describe("ActivitySection", () => {
  it("collapses completed activity behind a count summary and expands on click", async () => {
    render(
      <ActivitySection streaming={false} messages={[msg("m1", [toolPart, { type: "text", text: "interim" }])]} />
    );
    expect(screen.getByTestId("activity-toggle")).toHaveTextContent("1 tool call, 1 message");
    expect(screen.queryByText("List files")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("activity-toggle"));
    expect(screen.getByText("List files")).toBeInTheDocument();
  });

  it("streams expanded without a toggle", () => {
    render(<ActivitySection streaming messages={[msg("m1", [{ ...toolPart, status: "running" }])]} />);
    expect(screen.queryByTestId("activity-toggle")).not.toBeInTheDocument();
    expect(screen.getByText("List files")).toBeInTheDocument();
  });
});
```

`src/components/agent/parts/ToolCallRow.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { ToolCallRow } from "./ToolCallRow";

const part = { type: "tool-call" as const, toolUseId: "t1", toolName: "Edit", title: "Edit", detail: "/w/a.ts", status: "ok" as const, output: "done", fileChanges: [{ path: "/w/a.ts", additions: 3, deletions: 2, kind: "edit" as const }] };

describe("ToolCallRow", () => {
  it("shows title, detail chip, and file chips with counts; expands output on click", async () => {
    const onOpenFile = vi.fn();
    render(<ToolCallRow part={part} onOpenFile={onOpenFile} />);
    expect(screen.getByText("/w/a.ts", { selector: "code" })).toBeInTheDocument();
    expect(screen.getByText("+3")).toBeInTheDocument();
    expect(screen.getByText("-2")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("done")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("file-chip-/w/a.ts"));
    expect(onOpenFile).toHaveBeenCalledWith("/w/a.ts");
  });
});
```

Plus smoke tests for `ThinkingRow` (summary chip → expand), `UserMessage` (right-aligned text + attachment chip), `AssistantTurn` (final answer visible, activity collapsed), mirroring the pattern above.

Run: `bunx vitest run src/components/agent/ src/lib/agent/turns.test.ts` → ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/agent/ src/lib/agent/turns.ts src/lib/agent/turns.test.ts
git commit -m "feat(agent-ui): message part renderers — markdown, thinking, tool calls, activity collapse

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
### Task 11: Transcript + real AgentChatView (virtualized list, scroll pill, hydrate-on-visible)

**Files:**
- Create: `src/components/agent/Transcript.tsx`
- Modify: `src/components/agent/AgentChatView.tsx` (replace Task 3's placeholder)
- Modify: `package.json` (add `react-virtuoso`)
- Test: `src/components/agent/Transcript.test.tsx`, `src/components/agent/AgentChatView.test.tsx`

**Interfaces:**
- Consumes: `useAgentStore` (Task 9), `groupIntoTurns`/`UserMessage`/`AssistantTurn` (Task 10), `hydrateAgentSession` (Task 9), `useWorkbench().openFileTab` — check the actual opener in `src/state/store.ts` (grep `openFileTab`) and use its real signature for the file-chip click.
- Produces: `<AgentChatView workspace visible />` — final form consumed by `WorkspaceEditor` (already wired in Task 3); `<Transcript sessionId onOpenFile userActions(messageId) />` (userActions renders the per-user-message hover menu — Task 15 injects Rewind).

- [ ] **Step 1: Add the dependency**

```bash
bun add react-virtuoso
```

react-virtuoso is ~16KB gzipped — within the >1MB justification threshold, no PR note needed, but mention it in the PR description anyway per bundle-budget rule.

- [ ] **Step 2: Failing tests**

`src/components/agent/Transcript.test.tsx` (Virtuoso needs jsdom help: pass `initialItemCount` in a test-only prop):

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { Transcript } from "./Transcript";
import { useAgentStore, emptySession } from "@/state/agent-store";
import type { AgentChatMessage } from "@/lib/ipc";

const S = "sess1";
const m = (id: string, turnId: string, role: AgentChatMessage["role"], text: string): AgentChatMessage => ({
  id, turnId, role, sessionId: S, parts: [{ type: "text", text }], createdAt: 1,
});

beforeEach(() => {
  useAgentStore.setState({
    sessions: {
      [S]: {
        ...emptySession(),
        hydrated: true,
        messages: [m("u1", "t1", "user", "question one"), m("a1", "t1", "assistant", "answer one")],
      },
    },
  });
});

describe("Transcript", () => {
  it("renders user and assistant turns in order", () => {
    render(<Transcript sessionId={S} />);
    expect(screen.getByText("question one")).toBeInTheDocument();
    expect(screen.getByText("answer one")).toBeInTheDocument();
  });

  it("shows the working indicator while status is working", () => {
    useAgentStore.setState((s) => ({
      sessions: { ...s.sessions, [S]: { ...s.sessions[S], status: "working" } },
    }));
    render(<Transcript sessionId={S} />);
    expect(screen.getByTestId("agent-working")).toBeInTheDocument();
  });
});
```

`src/components/agent/AgentChatView.test.tsx` (mock `@/lib/agent/agent-events`):

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentChatView } from "./AgentChatView";
import { useAgentStore, emptySession } from "@/state/agent-store";
import type { Workspace } from "@/lib/ipc";

const hydrateAgentSession = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/agent/agent-events", () => ({
  hydrateAgentSession: (...a: unknown[]) => hydrateAgentSession(...a),
  ensureAgentEventSubscription: vi.fn(),
}));
vi.mock("@/lib/tauri", () => ({
  agentCapabilities: vi.fn().mockResolvedValue({ models: [], reasoningLevels: [], slashCommands: [], supportsInterrupt: true, supportsConversationRewind: true }),
  agentSend: vi.fn().mockResolvedValue({ queued: false }),
  agentInterrupt: vi.fn(),
  agentSetOptions: vi.fn(),
  agentQueueRemove: vi.fn(),
  agentRewind: vi.fn(),
  agentAttachmentSave: vi.fn(),
  fileSearch: vi.fn().mockResolvedValue({ hits: [], truncated: false }),
}));

const ws: Workspace = { id: "w1", projectId: "p1", branch: "b", agentBackend: "claude", worktreePath: "/w", status: "idle", sessionId: "sess1", mode: "agent" };

beforeEach(() => {
  hydrateAgentSession.mockClear();
  useAgentStore.setState({ sessions: { sess1: { ...emptySession(), hydrated: true } } });
});

describe("AgentChatView", () => {
  it("hydrates once when first visible", async () => {
    const { rerender } = render(<AgentChatView workspace={ws} visible={false} />);
    expect(hydrateAgentSession).not.toHaveBeenCalled();
    rerender(<AgentChatView workspace={ws} visible />);
    await waitFor(() => expect(hydrateAgentSession).toHaveBeenCalledWith("w1", "sess1"));
    rerender(<AgentChatView workspace={ws} visible={false} />);
    rerender(<AgentChatView workspace={ws} visible />);
    expect(hydrateAgentSession).toHaveBeenCalledTimes(1);
  });

  it("renders transcript + composer", async () => {
    render(<AgentChatView workspace={ws} visible />);
    expect(await screen.findByTestId("agent-composer")).toBeInTheDocument();
    expect(screen.getByTestId("agent-transcript")).toBeInTheDocument();
  });
});
```

(The Composer arrives in Task 12 — for THIS task render a `<div data-testid="agent-composer" />` placeholder footer inside AgentChatView; Task 12 swaps it.)

Run: `bunx vitest run src/components/agent/Transcript.test.tsx src/components/agent/AgentChatView.test.tsx` → FAIL.

- [ ] **Step 3: Implement Transcript**

`src/components/agent/Transcript.tsx`:

```tsx
import { useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { ArrowDown, LoaderCircle } from "lucide-react";
import { useAgentStore, emptySession } from "@/state/agent-store";
import { groupIntoTurns, type Turn } from "@/lib/agent/turns";
import { UserMessage } from "./parts/UserMessage";
import { AssistantTurn } from "./parts/AssistantTurn";
import { ChatMarkdown } from "./ChatMarkdown";

interface Props {
  sessionId: string;
  onOpenFile?: (path: string) => void;
  userActions?: (message: { id: string; text: string }) => React.ReactNode;
}

function TurnView({ turn, streaming, onOpenFile, userActions }: { turn: Turn; streaming: boolean } & Pick<Props, "onOpenFile" | "userActions">) {
  return (
    <div className="flex flex-col gap-3 px-4 py-2">
      {turn.user && (
        <UserMessage
          message={turn.user}
          actions={userActions?.({
            id: turn.user.id,
            text: turn.user.parts.filter((p) => p.type === "text").map((p) => (p.type === "text" ? p.text : "")).join("\n"),
          })}
        />
      )}
      <AssistantTurn messages={turn.assistant} streaming={streaming} onOpenFile={onOpenFile} />
      {turn.system.map((m) => (
        <div key={m.id} className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive" data-testid="agent-error-row">
          {m.parts.map((p, i) => (p.type === "text" ? <ChatMarkdown key={i} text={p.text} /> : null))}
        </div>
      ))}
    </div>
  );
}

export function Transcript({ sessionId, onOpenFile, userActions }: Props) {
  const slice = useAgentStore((s) => s.sessions[sessionId]) ?? emptySession();
  const turns = useMemo(() => groupIntoTurns(slice.messages), [slice.messages]);
  const virtuoso = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  const working = slice.status === "working";

  return (
    <div className="mv-transcript relative min-h-0 flex-1" data-testid="agent-transcript">
      <Virtuoso
        ref={virtuoso}
        data={turns}
        computeItemKey={(_, t) => t.turnId}
        followOutput={(isAtBottom) => (isAtBottom ? "smooth" : false)}
        atBottomStateChange={setAtBottom}
        initialTopMostItemIndex={Math.max(0, turns.length - 1)}
        itemContent={(index, turn) => (
          <TurnView
            turn={turn}
            streaming={working && index === turns.length - 1}
            onOpenFile={onOpenFile}
            userActions={userActions}
          />
        )}
        components={{
          Footer: () =>
            working ? (
              <div className="flex items-center gap-2 px-4 py-3 text-[12px] text-muted-foreground" data-testid="agent-working">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                Working…
              </div>
            ) : (
              <div className="h-2" />
            ),
        }}
      />
      {!atBottom && (
        <button
          type="button"
          onClick={() => virtuoso.current?.scrollToIndex({ index: turns.length - 1, behavior: "smooth", align: "end" })}
          data-testid="scroll-to-bottom"
          className="absolute bottom-3 left-1/2 z-overlay flex -translate-x-1/2 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground shadow-md transition-colors duration-100 hover:text-foreground"
        >
          <ArrowDown className="h-3 w-3" />
          Scroll to bottom
        </button>
      )}
    </div>
  );
}
```

If the two Transcript tests can't see items in jsdom (Virtuoso renders nothing without layout), add `initialItemCount={turns.length}` to the `<Virtuoso>` props — it is SSR-safe and makes jsdom render all items; keep it unconditional (harmless in production, first paint renders what fits).

- [ ] **Step 4: Implement the real AgentChatView**

Replace `src/components/agent/AgentChatView.tsx`:

```tsx
import { useEffect, useRef } from "react";
import type { Workspace } from "@/lib/ipc";
import { hydrateAgentSession } from "@/lib/agent/agent-events";
import { Transcript } from "./Transcript";

interface Props { workspace: Workspace; visible: boolean; }

export function AgentChatView({ workspace, visible }: Props) {
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!visible || hydratedRef.current) return;
    hydratedRef.current = true;
    hydrateAgentSession(workspace.id, workspace.sessionId).catch((e) => {
      hydratedRef.current = false;
      console.error("[agent] hydrate failed", e);
    });
  }, [visible, workspace.id, workspace.sessionId]);

  return (
    <div data-testid={`agent-chat-${workspace.id}`} className="mv-agentchat flex h-full flex-col bg-editor">
      <Transcript sessionId={workspace.sessionId} />
      <div data-testid="agent-composer" className="shrink-0" />
    </div>
  );
}
```

- [ ] **Step 5: Run tests + build**

```bash
bunx vitest run src/components/agent/
bun run build
```
Expected: ALL PASS, build clean.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/components/agent/
git commit -m "feat(agent-ui): virtualized transcript with turn grouping + AgentChatView hydrate-on-visible

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Composer — textarea, send/stop, queue row, model & reasoning menus

**Files:**
- Create: `src/components/agent/Composer.tsx`, `src/components/agent/ComposerMenus.tsx`
- Modify: `src/components/agent/AgentChatView.tsx` (mount Composer in the footer slot)
- Test: `src/components/agent/Composer.test.tsx`, `src/components/agent/ComposerMenus.test.tsx`

**Interfaces:**
- Consumes: `agentSend`, `agentInterrupt`, `agentQueueRemove`, `agentSetOptions`, `agentCapabilities` (Task 8), `useAgentStore` (Task 9).
- Produces:
  - `<Composer workspace />` — full input footer; exposes `data-testid="agent-composer"`, textarea `role="textbox"` with `aria-label="Message agent"`, send button `aria-label="Send"`, stop button `aria-label="Stop"`
  - `<ModelMenu value onSelect options />`, `<ReasoningMenu value onSelect options />` (dropdown-menu based)
  - Composer accepts optional `slots?: { beforeSend?: React.ReactNode }` and prop `onAttach` hooks are added in Tasks 13-14 — design them in now as no-op props: `attachments: AgentPart[]`, `onAttachmentsChange(next)`, `textareaDecorator?: (textarea: JSX.Element) => JSX.Element`.

Wait — simpler contract, do THIS: `Composer` owns draft text + attachments in local state; Tasks 13/14 modify `Composer.tsx` directly rather than through injection props. Keep the component focused.

- [ ] **Step 1: Failing tests**

`src/components/agent/Composer.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Composer } from "./Composer";
import { useAgentStore, emptySession } from "@/state/agent-store";
import type { Workspace } from "@/lib/ipc";
import * as tauri from "@/lib/tauri";

vi.mock("@/lib/tauri", () => ({
  agentSend: vi.fn().mockResolvedValue({ queued: false }),
  agentInterrupt: vi.fn().mockResolvedValue({ ok: true }),
  agentQueueRemove: vi.fn().mockResolvedValue({ ok: true }),
  agentSetOptions: vi.fn().mockResolvedValue({ ok: true }),
  agentCapabilities: vi.fn().mockResolvedValue({
    models: [{ id: "default", label: "Default" }, { id: "claude-opus-4-8", label: "Opus 4.8" }],
    reasoningLevels: [{ id: "default", label: "Default" }, { id: "high", label: "High" }],
    slashCommands: [{ name: "/compact", description: "Compact context" }],
    supportsInterrupt: true,
    supportsConversationRewind: true,
  }),
  agentAttachmentSave: vi.fn(),
  fileSearch: vi.fn().mockResolvedValue({ hits: [], truncated: false }),
}));
vi.mock("@/lib/file-drop", () => ({ registerFileDropTarget: vi.fn().mockReturnValue(() => {}) }));

const ws: Workspace = { id: "w1", projectId: "p1", branch: "b", agentBackend: "claude", worktreePath: "/w", status: "idle", sessionId: "s1", mode: "agent" };

beforeEach(() => {
  vi.clearAllMocks();
  useAgentStore.setState({ sessions: { s1: { ...emptySession(), hydrated: true } } });
});

describe("Composer", () => {
  it("sends trimmed text on Enter and clears the draft", async () => {
    render(<Composer workspace={ws} />);
    const box = await screen.findByRole("textbox", { name: "Message agent" });
    await userEvent.type(box, "  hello agent  {Enter}");
    expect(tauri.agentSend).toHaveBeenCalledWith("s1", [{ type: "text", text: "hello agent" }]);
    expect(box).toHaveValue("");
  });

  it("Shift+Enter inserts a newline instead of sending", async () => {
    render(<Composer workspace={ws} />);
    const box = await screen.findByRole("textbox", { name: "Message agent" });
    await userEvent.type(box, "line1{Shift>}{Enter}{/Shift}line2");
    expect(tauri.agentSend).not.toHaveBeenCalled();
    expect(box).toHaveValue("line1\nline2");
  });

  it("does not send an empty draft", async () => {
    render(<Composer workspace={ws} />);
    const box = await screen.findByRole("textbox", { name: "Message agent" });
    await userEvent.type(box, "   {Enter}");
    expect(tauri.agentSend).not.toHaveBeenCalled();
  });

  it("shows Stop while working; clicking it interrupts; Escape also interrupts", async () => {
    useAgentStore.setState({ sessions: { s1: { ...emptySession(), status: "working", hydrated: true } } });
    render(<Composer workspace={ws} />);
    const stop = await screen.findByRole("button", { name: "Stop" });
    await userEvent.click(stop);
    expect(tauri.agentInterrupt).toHaveBeenCalledWith("s1");
    await userEvent.keyboard("{Escape}");
    expect(tauri.agentInterrupt).toHaveBeenCalledTimes(2);
  });

  it("renders queued messages with a remove control", async () => {
    useAgentStore.setState({
      sessions: { s1: { ...emptySession(), hydrated: true, status: "working", queue: [{ id: "q1", parts: [{ type: "text", text: "queued msg" }], createdAt: 1 }] } },
    });
    render(<Composer workspace={ws} />);
    expect(await screen.findByText("queued msg")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove queued message" }));
    expect(tauri.agentQueueRemove).toHaveBeenCalledWith("s1", "q1");
  });
});
```

`src/components/agent/ComposerMenus.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { ModelMenu, ReasoningMenu } from "./ComposerMenus";

describe("ModelMenu / ReasoningMenu", () => {
  it("shows the current model label and fires onSelect", async () => {
    const onSelect = vi.fn();
    render(
      <ModelMenu
        value="claude-opus-4-8"
        options={[{ id: "default", label: "Default" }, { id: "claude-opus-4-8", label: "Opus 4.8" }]}
        onSelect={onSelect}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /opus 4.8/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Default" }));
    expect(onSelect).toHaveBeenCalledWith("default");
  });

  it("reasoning menu falls back to Default label when value is null", async () => {
    render(<ReasoningMenu value={null} options={[{ id: "default", label: "Default" }, { id: "high", label: "High" }]} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /default/i })).toBeInTheDocument();
  });
});
```

Run: `bunx vitest run src/components/agent/Composer.test.tsx src/components/agent/ComposerMenus.test.tsx` → FAIL.

- [ ] **Step 2: Implement ComposerMenus**

`src/components/agent/ComposerMenus.tsx`:

```tsx
import { BarChart3, Check, Sparkles } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { AgentModelOption } from "@/lib/ipc";

interface MenuProps {
  value: string | null;
  options: AgentModelOption[];
  onSelect: (id: string) => void;
}

function OptionMenu({ value, options, onSelect, icon: Icon, ariaLabel }: MenuProps & { icon: typeof Sparkles; ariaLabel: string }) {
  const current = options.find((o) => o.id === (value ?? "default")) ?? options[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors duration-100 hover:bg-muted hover:text-foreground"
        >
          <Icon className="h-3.5 w-3.5" />
          {current?.label ?? "Default"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {options.map((o) => (
          <DropdownMenuItem key={o.id} onClick={() => onSelect(o.id)} className="text-[12px]">
            <span className="flex-1">{o.label}</span>
            {o.id === (value ?? "default") && <Check className="h-3 w-3" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ModelMenu(props: MenuProps) {
  return <OptionMenu {...props} icon={Sparkles} ariaLabel="Model" />;
}

export function ReasoningMenu(props: MenuProps) {
  return <OptionMenu {...props} icon={BarChart3} ariaLabel="Reasoning level" />;
}
```

- [ ] **Step 3: Implement Composer**

`src/components/agent/Composer.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square, X } from "lucide-react";
import type { AgentCapabilities, AgentPart, Workspace } from "@/lib/ipc";
import {
  agentCapabilities, agentInterrupt, agentQueueRemove, agentSend, agentSetOptions,
} from "@/lib/tauri";
import { useAgentStore, emptySession } from "@/state/agent-store";
import { ModelMenu, ReasoningMenu } from "./ComposerMenus";

interface Props { workspace: Workspace; }

export function Composer({ workspace }: Props) {
  const sessionId = workspace.sessionId;
  const slice = useAgentStore((s) => s.sessions[sessionId]) ?? emptySession();
  const setOptionsLocal = useAgentStore((s) => s.setOptionsLocal);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Extract<AgentPart, { type: "attachment" }>[]>([]);
  const [caps, setCaps] = useState<AgentCapabilities | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const working = slice.status === "working";

  useEffect(() => {
    let cancelled = false;
    agentCapabilities(workspace.id)
      .then((c) => { if (!cancelled) setCaps(c); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [workspace.id]);

  function autoGrow() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  async function send() {
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    const parts: AgentPart[] = [
      ...(text ? [{ type: "text" as const, text }] : []),
      ...attachments,
    ];
    setDraft("");
    setAttachments([]);
    requestAnimationFrame(autoGrow);
    try {
      await agentSend(sessionId, parts);
    } catch (e) {
      console.error("[agent] send failed", e);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    } else if (e.key === "Escape" && working) {
      e.preventDefault();
      void agentInterrupt(sessionId);
    }
  }

  function selectModel(id: string) {
    setOptionsLocal(sessionId, { model: id });
    void agentSetOptions(sessionId, { model: id });
  }

  function selectReasoning(id: string) {
    setOptionsLocal(sessionId, { reasoningLevel: id });
    void agentSetOptions(sessionId, { reasoningLevel: id });
  }

  return (
    <div className="mv-composer flex shrink-0 flex-col gap-2 border-t border-border bg-editor p-3" data-testid="agent-composer">
      {slice.queue.length > 0 && (
        <div className="flex flex-col gap-1">
          {slice.queue.map((q) => (
            <div key={q.id} className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-[12px] text-muted-foreground">
              <span className="flex-1 truncate">
                {q.parts.filter((p) => p.type === "text").map((p) => (p.type === "text" ? p.text : "")).join(" ")}
              </span>
              <span className="text-[10px] uppercase tracking-wide">queued</span>
              <button
                type="button"
                aria-label="Remove queued message"
                onClick={() => void agentQueueRemove(sessionId, q.id)}
                className="flex h-4 w-4 items-center justify-center rounded-sm hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((a) => (
            <span key={a.path} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
              <span className="max-w-[200px] truncate">{a.name}</span>
              <button
                type="button"
                aria-label={`Remove attachment ${a.name}`}
                onClick={() => setAttachments((prev) => prev.filter((x) => x.path !== a.path))}
                className="flex h-3.5 w-3.5 items-center justify-center rounded-sm hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card focus-within:border-accent/50">
        <textarea
          ref={textareaRef}
          aria-label="Message agent"
          value={draft}
          rows={2}
          onChange={(e) => { setDraft(e.target.value); autoGrow(); }}
          onKeyDown={onKeyDown}
          placeholder="Ask to make changes, @mention files, run /commands"
          className="max-h-[200px] w-full resize-none bg-transparent px-3 pt-3 font-mono text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <ModelMenu value={slice.model} options={caps?.models ?? []} onSelect={selectModel} />
          <ReasoningMenu value={slice.reasoningLevel} options={caps?.reasoningLevels ?? []} onSelect={selectReasoning} />
          <div className="flex-1" />
          {working ? (
            <button
              type="button"
              aria-label="Stop"
              onClick={() => void agentInterrupt(sessionId)}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-foreground transition-colors duration-100 hover:bg-destructive/20 hover:text-destructive"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Send"
              disabled={!draft.trim() && attachments.length === 0}
              onClick={() => void send()}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-foreground transition-colors duration-100 hover:bg-accent/90 disabled:opacity-40"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Mount in AgentChatView**

Replace the placeholder footer div from Task 11:

```tsx
import { Composer } from "./Composer";
// …
      <Transcript sessionId={workspace.sessionId} />
      <Composer workspace={workspace} />
```

(Remove `data-testid="agent-composer"` placeholder — the Composer root carries it.)

- [ ] **Step 5: Run tests**

```bash
bunx vitest run src/components/agent/
```
Expected: ALL PASS (update the AgentChatView test if the placeholder assertion needs the real composer now — it queries the same testid, so it should pass unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/components/agent/
git commit -m "feat(agent-ui): composer with send/stop, queued messages, model + reasoning menus

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: /slash and @mention trigger menu

**Files:**
- Create: `src/components/agent/TriggerMenu.tsx`, `src/lib/agent/trigger.ts`
- Modify: `src/components/agent/Composer.tsx`
- Test: `src/lib/agent/trigger.test.ts`, `src/components/agent/TriggerMenu.test.tsx`

**Interfaces:**
- Consumes: `fileSearch(worktreePath, query, limit)` (`src/lib/tauri.ts:259`, returns `SearchResult { hits, truncated }` — check `SearchHit`'s field name for the path in `src/lib/ipc.ts:410-423` and use it), `AgentSlashCommand` from capabilities (Task 12's `caps`).
- Produces:
  - `detectTrigger(text: string, caret: number): { kind: "slash" | "mention"; query: string; start: number } | null`
  - `applyTrigger(text: string, trigger, replacement: string): { text: string; caret: number }`
  - `<TriggerMenu workspace caps draft caret onPick(next: {text; caret}) anchor />` — renders a shadcn Command list in an absolutely-positioned panel above the textarea (NOT a Radix popover — focus must stay in the textarea).

- [ ] **Step 1: Pure trigger logic — failing tests**

`src/lib/agent/trigger.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { detectTrigger, applyTrigger } from "./trigger";

describe("detectTrigger", () => {
  it("detects / only at the start of the draft", () => {
    expect(detectTrigger("/comp", 5)).toEqual({ kind: "slash", query: "comp", start: 0 });
    expect(detectTrigger("run /comp", 9)).toBeNull();
  });
  it("detects @ after whitespace or at start, query up to the caret", () => {
    expect(detectTrigger("fix @db-re", 10)).toEqual({ kind: "mention", query: "db-re", start: 4 });
    expect(detectTrigger("@src", 4)).toEqual({ kind: "mention", query: "src", start: 0 });
    expect(detectTrigger("email me a@b", 12)).toBeNull();
  });
  it("no trigger once the token contains whitespace or the caret left the token", () => {
    expect(detectTrigger("fix @db rep", 11)).toBeNull();
    expect(detectTrigger("fix @db", 3)).toBeNull();
  });
});

describe("applyTrigger", () => {
  it("replaces the trigger token and appends a space", () => {
    expect(applyTrigger("fix @db-re please", { kind: "mention", query: "db-re", start: 4 }, "@scripts/db-repl.ts")).toEqual({
      text: "fix @scripts/db-repl.ts  please",
      caret: 24,
    });
  });
});
```

`src/lib/agent/trigger.ts`:

```ts
export interface Trigger {
  kind: "slash" | "mention";
  query: string;
  start: number;
}

export function detectTrigger(text: string, caret: number): Trigger | null {
  const upToCaret = text.slice(0, caret);
  if (upToCaret.startsWith("/") && !/\s/.test(upToCaret)) {
    return { kind: "slash", query: upToCaret.slice(1), start: 0 };
  }
  const at = upToCaret.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upToCaret[at - 1])) return null;
  const token = upToCaret.slice(at + 1);
  if (/\s/.test(token)) return null;
  return { kind: "mention", query: token, start: at };
}

export function applyTrigger(text: string, trigger: Trigger, replacement: string): { text: string; caret: number } {
  const tokenLen = (trigger.kind === "slash" ? 1 : 1) + trigger.query.length;
  const before = text.slice(0, trigger.start);
  const after = text.slice(trigger.start + tokenLen);
  const next = `${before}${replacement} ${after}`;
  return { text: next, caret: before.length + replacement.length + 1 };
}
```

Run: `bunx vitest run src/lib/agent/trigger.test.ts` → adjust expected caret math in the test to the implementation's actual (correct) output, then PASS. (The example above: `before="fix "` (4) + replacement (19) + 1 = 24.)

- [ ] **Step 2: TriggerMenu component — failing test**

`src/components/agent/TriggerMenu.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { TriggerMenu } from "./TriggerMenu";
import * as tauri from "@/lib/tauri";

vi.mock("@/lib/tauri", () => ({ fileSearch: vi.fn().mockResolvedValue({ hits: [{ path: "scripts/db-repl.ts" }], truncated: false }) }));

const caps = {
  models: [], reasoningLevels: [], supportsInterrupt: true, supportsConversationRewind: true,
  slashCommands: [{ name: "/compact", description: "Compact context" }, { name: "/review", description: "Review changes" }],
};

describe("TriggerMenu", () => {
  it("lists slash commands filtered by the query and picks on click", async () => {
    const onPick = vi.fn();
    render(<TriggerMenu worktreePath="/w" caps={caps} draft="/comp" caret={5} onPick={onPick} />);
    expect(await screen.findByText("/compact")).toBeInTheDocument();
    expect(screen.queryByText("/review")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("/compact"));
    expect(onPick).toHaveBeenCalledWith({ text: "/compact ", caret: 9 });
  });

  it("lists file hits for @ queries", async () => {
    render(<TriggerMenu worktreePath="/w" caps={caps} draft="fix @db" caret={7} onPick={() => {}} />);
    await waitFor(() => expect(tauri.fileSearch).toHaveBeenCalledWith("/w", "db", 8));
    expect(await screen.findByText("scripts/db-repl.ts")).toBeInTheDocument();
  });

  it("renders nothing without an active trigger", () => {
    const { container } = render(<TriggerMenu worktreePath="/w" caps={caps} draft="plain text" caret={10} onPick={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

(Before writing the test, check `SearchHit` in `src/lib/ipc.ts` — if the field is `file` or `relativePath` instead of `path`, use the real field everywhere here.)

- [ ] **Step 3: Implement TriggerMenu**

`src/components/agent/TriggerMenu.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { FileText, SlashSquare } from "lucide-react";
import { fileSearch } from "@/lib/tauri";
import type { AgentCapabilities } from "@/lib/ipc";
import { applyTrigger, detectTrigger } from "@/lib/agent/trigger";

interface Props {
  worktreePath: string;
  caps: Pick<AgentCapabilities, "slashCommands"> | null;
  draft: string;
  caret: number;
  onPick: (next: { text: string; caret: number }) => void;
}

interface Item { key: string; label: string; description?: string; insert: string; icon: "file" | "slash" }

export function TriggerMenu({ worktreePath, caps, draft, caret, onPick }: Props) {
  const trigger = useMemo(() => detectTrigger(draft, caret), [draft, caret]);
  const [fileHits, setFileHits] = useState<string[]>([]);

  useEffect(() => {
    if (!trigger || trigger.kind !== "mention" || trigger.query.length < 1) {
      setFileHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      fileSearch(worktreePath, trigger.query, 8)
        .then((res) => { if (!cancelled) setFileHits(res.hits.map((h) => h.path)); })
        .catch(() => { if (!cancelled) setFileHits([]); });
    }, 120);
    return () => { cancelled = true; clearTimeout(t); };
  }, [trigger?.kind, trigger?.query, worktreePath]);

  if (!trigger) return null;

  const items: Item[] =
    trigger.kind === "slash"
      ? (caps?.slashCommands ?? [])
          .filter((c) => c.name.slice(1).toLowerCase().startsWith(trigger.query.toLowerCase()))
          .map((c) => ({ key: c.name, label: c.name, description: c.description, insert: c.name, icon: "slash" as const }))
      : fileHits.map((p) => ({ key: p, label: p, insert: `@${p}`, icon: "file" as const }));

  if (items.length === 0) return null;

  return (
    <div
      data-testid="trigger-menu"
      className="mv-triggermenu absolute bottom-full left-0 z-overlay mb-1 max-h-56 w-full max-w-md overflow-y-auto rounded-md border border-border bg-card p-1 shadow-md"
      role="listbox"
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="option"
          aria-selected={false}
          onMouseDown={(e) => {
            e.preventDefault(); // keep textarea focus
            onPick(applyTrigger(draft, trigger, item.insert));
          }}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] text-foreground hover:bg-muted"
        >
          {item.icon === "slash" ? <SlashSquare className="h-3.5 w-3.5 shrink-0 opacity-70" /> : <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />}
          <span className="truncate font-mono">{item.label}</span>
          {item.description && <span className="ml-auto truncate text-[11px] text-muted-foreground">{item.description}</span>}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Wire into Composer**

In `Composer.tsx`: track `caret` state (update in `onChange`, `onKeyUp`, `onClick` of the textarea via `e.currentTarget.selectionStart`), make the textarea's wrapper `relative`, render above the textarea:

```tsx
        <div className="relative">
          <TriggerMenu
            worktreePath={workspace.worktreePath}
            caps={caps}
            draft={draft}
            caret={caret}
            onPick={({ text, caret: nextCaret }) => {
              setDraft(text);
              requestAnimationFrame(() => {
                const el = textareaRef.current;
                if (el) { el.focus(); el.setSelectionRange(nextCaret, nextCaret); setCaret(nextCaret); }
              });
            }}
          />
          <textarea … />
        </div>
```

Add a Composer test:

```tsx
  it("picking a mention replaces the token in the draft", async () => {
    render(<Composer workspace={ws} />);
    const box = await screen.findByRole("textbox", { name: "Message agent" });
    await userEvent.type(box, "fix @db");
    expect(await screen.findByText("scripts/db-repl.ts")).toBeInTheDocument();
    await userEvent.click(screen.getByText("scripts/db-repl.ts"));
    expect(box).toHaveValue("fix @scripts/db-repl.ts ");
  });
```

(Update the Composer test file's `fileSearch` mock to return `{ hits: [{ path: "scripts/db-repl.ts" }], truncated: false }`.)

- [ ] **Step 5: Run + commit**

```bash
bunx vitest run src/lib/agent/trigger.test.ts src/components/agent/
git add src/lib/agent/trigger.ts src/lib/agent/trigger.test.ts src/components/agent/
git commit -m "feat(agent-ui): /slash-command and @file-mention trigger menu in composer

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: Attachments — whole-composer drop zone + paste-to-attach

**Files:**
- Modify: `src/components/agent/Composer.tsx`
- Test: `src/components/agent/Composer.test.tsx` (extend)

**Interfaces:**
- Consumes: `registerFileDropTarget(el, { onPaths, onDragState? })` (`src/lib/file-drop.ts:116` — Tauri swallows DOM drops; this is the only working drop path), `agentAttachmentSave` (Task 8).
- Produces: attachment chips in the composer (already rendered by Task 12's `attachments` state); dropped files become `{ type: "attachment", name, path, mime }` parts; pasted text > 2000 chars becomes a saved `pasted_text_<n>.txt` attachment.

- [ ] **Step 1: Failing tests**

Extend `Composer.test.tsx`:

```tsx
import { registerFileDropTarget } from "@/lib/file-drop";

  it("registers the composer as a file-drop target and adds chips for dropped paths", async () => {
    render(<Composer workspace={ws} />);
    await screen.findByRole("textbox", { name: "Message agent" });
    const call = vi.mocked(registerFileDropTarget).mock.calls[0];
    expect(call).toBeDefined();
    call[1].onPaths(["/tmp/Screenshot 2026-07-02.png"]);
    expect(await screen.findByText("Screenshot 2026-07-02.png")).toBeInTheDocument();
    // dropped attachments ride along on send
    await userEvent.type(screen.getByRole("textbox", { name: "Message agent" }), "look{Enter}");
    expect(tauri.agentSend).toHaveBeenCalledWith("s1", [
      { type: "text", text: "look" },
      { type: "attachment", name: "Screenshot 2026-07-02.png", path: "/tmp/Screenshot 2026-07-02.png", mime: "image/png" },
    ]);
  });

  it("large pasted text becomes a saved attachment instead of draft text", async () => {
    vi.mocked(tauri.agentAttachmentSave).mockResolvedValue({ path: "/att/pasted_text_1.txt" });
    render(<Composer workspace={ws} />);
    const box = await screen.findByRole("textbox", { name: "Message agent" });
    box.focus();
    await userEvent.paste("x".repeat(3000));
    await waitFor(() => expect(tauri.agentAttachmentSave).toHaveBeenCalled());
    expect(await screen.findByText(/pasted_text/)).toBeInTheDocument();
    expect(box).toHaveValue("");
  });
```

Run → FAIL.

- [ ] **Step 2: Implement**

In `Composer.tsx`:

```tsx
import { registerFileDropTarget } from "@/lib/file-drop";

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json",
};

export function attachmentForPath(path: string): Extract<AgentPart, { type: "attachment" }> {
  const name = path.split(/[/\\]/).pop() ?? path;
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return { type: "attachment", name, path, mime: MIME_BY_EXT[ext] ?? "application/octet-stream" };
}
```

Inside the component:

```tsx
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const pasteCounter = useRef(0);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    return registerFileDropTarget(el, {
      onPaths: (paths) =>
        setAttachments((prev) => {
          const known = new Set(prev.map((a) => a.path));
          return [...prev, ...paths.filter((p) => !known.has(p)).map(attachmentForPath)];
        }),
      onDragState: setDragOver,
    });
  }, []);

  async function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const text = e.clipboardData.getData("text/plain");
    if (text.length <= 2000) return;
    e.preventDefault();
    pasteCounter.current += 1;
    const name = `pasted_text_${pasteCounter.current}.txt`;
    try {
      const { path } = await agentAttachmentSave(sessionId, name, btoa(unescape(encodeURIComponent(text))));
      setAttachments((prev) => [...prev, { type: "attachment", name: path.split(/[/\\]/).pop() ?? name, path, mime: "text/plain" }]);
    } catch (err) {
      console.error("[agent] paste attachment failed", err);
      setDraft((d) => d + text);
    }
  }
```

Attach `ref={rootRef}` to the composer root div, `onPaste={onPaste}` to the textarea, and a drag highlight on the input card: `className={cn("… rounded-lg border …", dragOver ? "border-accent" : "border-border")}`. Import `agentAttachmentSave` from `@/lib/tauri` and export `attachmentForPath` for its own unit test if placed here (or move it to `src/lib/agent/attachments.ts` with a 3-line test — prefer the separate file to satisfy the every-public-function-tested rule cleanly).

- [ ] **Step 3: Run + commit**

```bash
bunx vitest run src/components/agent/Composer.test.tsx
git add src/components/agent/ src/lib/agent/
git commit -m "feat(agent-ui): composer drop-zone + paste-to-attachment

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 15: Rewind — per-user-message menu, confirm dialog, refetch

**Files:**
- Create: `src/components/agent/RewindMenu.tsx`
- Modify: `src/components/agent/AgentChatView.tsx` (wire `userActions` + file-open)
- Test: `src/components/agent/RewindMenu.test.tsx`

**Interfaces:**
- Consumes: `agentRewind(sessionId, messageId)` (Task 8), `hydrateAgentSession` (Task 9), `Transcript`'s `userActions` slot (Task 11), `useWorkbench` file-tab opener (grep `openFileTab` in `src/state/store.ts` for the real signature).
- Produces: hover ⋮ on each user message → "Rewind to here" → confirm dialog → rewind + rehydrate + draft restore.

- [ ] **Step 1: Failing test**

`src/components/agent/RewindMenu.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RewindMenu } from "./RewindMenu";
import * as tauri from "@/lib/tauri";

vi.mock("@/lib/tauri", () => ({ agentRewind: vi.fn().mockResolvedValue({ ok: true }) }));

describe("RewindMenu", () => {
  beforeEach(() => vi.clearAllMocks());

  it("confirms before rewinding and reports completion", async () => {
    const onRewound = vi.fn();
    render(<RewindMenu sessionId="s1" messageId="m1" messageText="original prompt" onRewound={onRewound} />);
    await userEvent.click(screen.getByRole("button", { name: "Message actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /rewind to here/i }));
    // dialog explains the blast radius
    expect(await screen.findByText(/restores the worktree/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Rewind" }));
    expect(tauri.agentRewind).toHaveBeenCalledWith("s1", "m1");
    await vi.waitFor(() => expect(onRewound).toHaveBeenCalledWith("original prompt"));
  });

  it("cancel closes without calling rewind", async () => {
    render(<RewindMenu sessionId="s1" messageId="m1" messageText="t" onRewound={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Message actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /rewind to here/i }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(tauri.agentRewind).not.toHaveBeenCalled();
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement**

`src/components/agent/RewindMenu.tsx`:

```tsx
import { useState } from "react";
import { EllipsisVertical, History } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { agentRewind } from "@/lib/tauri";

interface Props {
  sessionId: string;
  messageId: string;
  messageText: string;
  onRewound: (messageText: string) => void;
}

export function RewindMenu({ sessionId, messageId, messageText, onRewound }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function doRewind() {
    setBusy(true);
    try {
      await agentRewind(sessionId, messageId);
      setConfirming(false);
      onRewound(messageText);
    } catch (e) {
      console.error("[agent] rewind failed", e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Message actions"
            className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <EllipsisVertical className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => setConfirming(true)} className="text-[12px]">
            <History className="h-3.5 w-3.5" />
            Rewind to here
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirming} onOpenChange={(o) => !busy && setConfirming(o)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rewind to this message?</DialogTitle>
            <DialogDescription>
              Restores the worktree files to the state before this message was sent and removes this and all later messages from the conversation.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={() => void doRewind()} disabled={busy}>Rewind</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 3: Wire into AgentChatView**

`AgentChatView.tsx` — pass `userActions` and a file-opener into `Transcript`, and give `Composer` a draft-restore path. Add a `draftRestore` piece of state shared via prop:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { RewindMenu } from "./RewindMenu";
import { useWorkbench } from "@/state/store";

  const [restoredDraft, setRestoredDraft] = useState<string | null>(null);

  const onRewound = useCallback(
    (messageText: string) => {
      hydrateAgentSession(workspace.id, workspace.sessionId).catch(() => {});
      setRestoredDraft(messageText);
    },
    [workspace.id, workspace.sessionId]
  );

  const openFile = useCallback((path: string) => {
    // Use the real opener found in src/state/store.ts (grep openFileTab / openFile);
    // it takes (workspaceId, absolutePath) or a tab object — match its signature.
    useWorkbench.getState().openFileTab(workspace.id, path);
  }, [workspace.id]);

  // render:
      <Transcript
        sessionId={workspace.sessionId}
        onOpenFile={openFile}
        userActions={({ id, text }) => (
          <RewindMenu sessionId={workspace.sessionId} messageId={id} messageText={text} onRewound={onRewound} />
        )}
      />
      <Composer workspace={workspace} restoredDraft={restoredDraft} onRestoredDraftConsumed={() => setRestoredDraft(null)} />
```

In `Composer.tsx` accept the two new optional props and consume them:

```tsx
  useEffect(() => {
    if (restoredDraft == null) return;
    setDraft(restoredDraft);
    onRestoredDraftConsumed?.();
    requestAnimationFrame(() => { textareaRef.current?.focus(); autoGrow(); });
  }, [restoredDraft]);
```

Add an AgentChatView test asserting the rewind flow end-to-end at the view level (menu → confirm → `agentRewind` called → hydrate re-invoked), reusing the mocks from Task 11's test file.

- [ ] **Step 4: Run + commit**

```bash
bunx vitest run src/components/agent/
git add src/components/agent/
git commit -m "feat(agent-ui): rewind-to-message with checkpoint restore confirm + draft recovery

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 16: Final verification — full suites, builds, live golden path

**Files:** none new (fixes only).

- [ ] **Step 1: Full automated pass**

```bash
bun test sidecar/
bunx vitest run src/
cargo test --workspace --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
bun run build
bunx vitest run --coverage src/components/agent src/lib/agent src/state/agent-store.ts
```
Expected: everything green; new-file coverage at thresholds (repo-wide gate is pre-existingly red — do not chase unrelated files).

- [ ] **Step 2: Live golden path (`bun run tauri dev`)**

Fresh-clone note: if sidecar deps are missing run `cd sidecar && bun install` first (non-workspace package).

1. Create a workspace with mode **Agent** → chat view opens; EditorTabs shows ONLY this workspace's tabs.
2. Send "create hello.txt containing hi, then read it back" → user bubble right-aligned; tool calls stream; activity collapses to "N tool calls, M messages" after the turn; final answer renders as markdown; StatusBar pill flips working→idle.
3. While a turn runs, send another message → it queues; remove it; send again and let it drain.
4. Switch model to another entry + reasoning to High → next send respawns with `--resume` (verify via `ps aux | grep "claude --input-format"` that flags include `--model`/`--effort`/`--resume`).
5. `@`-mention a file and `/`-trigger the slash menu.
6. Drag a file onto the composer → chip appears; paste 3k chars → `pasted_text_*.txt` chip.
7. Hover the first user message → ⋮ → Rewind → confirm → `hello.txt` is gone from the worktree, transcript truncated, draft restored. Send a follow-up and confirm the agent's context matches the rewound state (the riskiest behavior — if the forked `--resume` fails, the send must still work as a fresh session; capture what happened).
8. Quit + relaunch → transcript rehydrates from SQLite; no orphan `claude` processes (`ps aux | grep claude`).
9. Open a second terminal group in the agent workspace → normal shell works beside the chat.
10. Create a Terminal-mode workspace → behavior identical to before this feature.

- [ ] **Step 3: Update docs**

Add Agent Mode to `README.md` features and `SYSTEM-DESIGN.md` (agent.* RPC surface + `agent:event` channel + migration 006) — coordinator-zone files, so do this in the final PR commit, not a subagent.

- [ ] **Step 4: Commit any fixes + report**

```bash
git add -A && git commit -m "chore(agent): verification fixes for agent mode golden path

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Report per finishing-a-development-branch: outcomes of steps 1-2 verbatim, especially item 7 (conversation-fork reality check) and any CLI-version deviations found in Task 4 Step 6 / Task 6 Step 4.

---

## Plan self-review notes (already applied)

- **Spec coverage:** mode selection (T3), unified protocol (T4), Claude adapter (T4), bypassPermissions (T4 buildSpawn), checkpoints/rewind files+conversation (T5/T6/T7/T15), queue (T7/T12), model/reasoning switchers (T12), slash + mention (T13), drop zone + paste (T14), status-store bridge + OS notifications (T9), persistence/rehydrate (T2/T7/T9/T11), workspace-scoped tabs (T1), terminal coexistence (T3/T16.9). `permission-request` is a reserved event only — by design (spec non-goal).
- **Deviations from spec:** attachments are sent as path references (`[Attached file: …]`), not base64 content blocks — the CLI reads files (incl. images) from disk itself; simpler and provider-agnostic. Hover diff-preview on file chips is deferred: chips open the file via the existing viewer tabs instead (spec's "lightweight patch preview" needs the old/new content plumbed through tool parts — revisit post-v1).
- **Type consistency:** protocol type is `AgentChatMessage` everywhere (never `AgentMessage`); store method names `sessionMetaGet/Set`, `agentMessageAppend`, `messagesTruncateFrom`, `checkpointByMessage`, `checkpointsTruncateFrom` are used identically in Tasks 2, 7, 8.
- **Known verify-first risks** (each has an in-plan fallback): `--effort` flag (T4.6), `--include-partial-messages` shapes (T4.6), `~/.claude/projects` layout + forged-session resume (T6.4, T16.2.7), `SearchHit.path` field name (T13), `openFileTab` signature (T15), `FileTab` shape in tests (T1).




