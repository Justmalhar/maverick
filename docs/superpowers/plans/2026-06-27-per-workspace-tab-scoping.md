# Per-Workspace Tab Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope editor tabs to the active workspace and let each workspace own multiple terminal-session tabs (each internally splittable).

**Architecture:** Introduce per-workspace **terminal groups** whose *primary* group id equals `workspace.id` (so `splitTrees`, `${workspace.id}-N` leaves, `primaryAgentPtyId`, presets and ai-actions are untouched). Extra groups get `term-<uuid>` ids. `EditorTabs` renders all workspace chips as switchers but only the *context* workspace's terminal-group tabs and file tabs. The global standalone-terminal concept is removed. The existing `activeWorkspaceId` / `activeFileTabId` / `activeSystemTab` pointers and their four-way exclusivity are kept.

**Tech Stack:** React 19, Zustand (`subscribeWithSelector`), Tailwind v4, Vitest + @testing-library/react, xterm.js via TerminalRegistry.

## Global Constraints

- **bun, not npm.** Tests: `bun run test -- <path>`; coverage: `bun run test:coverage`.
- **Coverage thresholds (CI-enforced):** lines 100, branches 95, functions 100, statements 100.
- **VSCode terminology only.** `EditorTabs`, `EditorGroup`, `WorkspaceEditor`, `TerminalView`, `SplitGrid`. CSS classes `.mv-*`.
- **Keep-alive mount** for inactive editor groups/terminal groups: `display:none` (class `keep-alive-hidden content-visibility-auto`), never unmount. PTYs survive tab switches.
- **TerminalView never imports xterm.js** — only through TerminalRegistry/SplitGrid (already true; do not regress).
- **No comments explaining WHAT;** only non-obvious WHY.
- **No `any` types.**
- File ownership zones: store/registry/editor/terminal/hooks are in the "Editor/Terminal agent" + "Frontend shell" zones; tests may touch any zone.

## Definitions (used across tasks)

```ts
// src/state/store.ts
export interface TerminalGroup {
  id: string;          // primary group id === workspace.id; extras: `term-<uuid>`
  workspaceId: string;
  title: string;       // e.g. "Terminal 1", "Terminal 2"
}
```

- **Primary group**: the group whose `id === workspaceId`. Always exists for every workspace. Not individually closable.
- **Context workspace**: `activeWorkspaceId` if set, else the workspace owning the active file tab (`fileTab.workspaceId`), else `null`.

---

## Task 1: Store — terminal-group model

**Files:**
- Modify: `src/state/store.ts`
- Test: `src/state/store.test.ts`

**Interfaces:**
- Produces:
  - `interface TerminalGroup { id: string; workspaceId: string; title: string }`
  - state `terminalGroups: TerminalGroup[]`
  - state `activeGroupByWorkspace: Record<string, string>`
  - `addTerminalGroup(workspaceId: string): string` — creates an extra group (`term-<uuid>`), appends it, sets it active for that workspace, returns its id.
  - `closeTerminalGroup(groupId: string): void` — removes an *extra* group (no-op if it is a primary group), deletes its split tree, re-points `activeGroupByWorkspace` to the previous group of that workspace.
  - `setActiveGroup(workspaceId: string, groupId: string): void`
  - helper `selectWorkspaceGroups(workspaceId: string) => (s) => TerminalGroup[]`
- Consumes: existing `addWorkspace`, `setWorkspaces`, `removeWorkspace`, `splitTrees`.

**Notes for implementer:**
- A workspace's **primary group** (`id === workspace.id`) is materialized in `addWorkspace` and `setWorkspaces` (so workspaces restored from disk also get one). Title `"Terminal 1"`.
- `addWorkspace` also sets `activeGroupByWorkspace[ws.id] = ws.id`.
- `setWorkspaces` rebuilds `terminalGroups` to: keep existing groups whose `workspaceId` still exists, plus a primary group for any workspace lacking one. Prune `activeGroupByWorkspace` entries for removed workspaces; default missing entries to the workspace's primary id.
- `removeWorkspace` must drop all `terminalGroups` for that workspace and their `splitTrees`, and delete its `activeGroupByWorkspace` entry. (Leaf-kill wiring is Task 2.)
- `crypto.randomUUID()` is available (already used in `useTerminalTab`).
- Title for extra groups: `"Terminal " + (count of that workspace's groups + 1)`.
- **Update `src/state/store.test.ts` `beforeEach`** (lines ~34-65): add `terminalGroups: [],` and `activeGroupByWorkspace: {},` to the `useWorkbench.setState({...})` reset so other tests start clean.
- The new tests below use the `makeWorkspace` fixture from `@/test/fixtures` rather than the inline `freshWorkspace` if you prefer; either works as long as ids match.

- [ ] **Step 1: Write failing tests**

Add to `src/state/store.test.ts`:

```ts
import { useWorkbench } from "@/state/store";

function freshWorkspace(id: string) {
  return {
    id, projectId: "p1", branch: "b", agentBackend: "claude",
    worktreePath: `/wt/${id}`, status: "active" as const, sessionId: "s",
  };
}

describe("terminal groups", () => {
  beforeEach(() => {
    useWorkbench.setState({
      workspaces: [], terminalGroups: [], activeGroupByWorkspace: {},
      splitTrees: {}, activeWorkspaceId: null,
    });
  });

  it("seeds a primary group (id === workspace.id) on addWorkspace", () => {
    useWorkbench.getState().addWorkspace(freshWorkspace("w1"));
    const groups = useWorkbench.getState().terminalGroups;
    expect(groups).toEqual([{ id: "w1", workspaceId: "w1", title: "Terminal 1" }]);
    expect(useWorkbench.getState().activeGroupByWorkspace.w1).toBe("w1");
  });

  it("addTerminalGroup appends an extra group and activates it", () => {
    const s = useWorkbench.getState();
    s.addWorkspace(freshWorkspace("w1"));
    const id = useWorkbench.getState().addTerminalGroup("w1");
    expect(id).toMatch(/^term-/);
    const groups = useWorkbench.getState().terminalGroups.filter((g) => g.workspaceId === "w1");
    expect(groups.map((g) => g.id)).toEqual(["w1", id]);
    expect(groups[1].title).toBe("Terminal 2");
    expect(useWorkbench.getState().activeGroupByWorkspace.w1).toBe(id);
  });

  it("closeTerminalGroup removes an extra group, deletes its tree, re-points active", () => {
    useWorkbench.getState().addWorkspace(freshWorkspace("w1"));
    const id = useWorkbench.getState().addTerminalGroup("w1");
    useWorkbench.setState((st) => ({ splitTrees: { ...st.splitTrees, [id]: { type: "terminal", id: `${id}-1`, backend: "claude", ptyId: id } } }));
    useWorkbench.getState().closeTerminalGroup(id);
    expect(useWorkbench.getState().terminalGroups.find((g) => g.id === id)).toBeUndefined();
    expect(useWorkbench.getState().splitTrees[id]).toBeUndefined();
    expect(useWorkbench.getState().activeGroupByWorkspace.w1).toBe("w1");
  });

  it("closeTerminalGroup is a no-op for a primary group", () => {
    useWorkbench.getState().addWorkspace(freshWorkspace("w1"));
    useWorkbench.getState().closeTerminalGroup("w1");
    expect(useWorkbench.getState().terminalGroups.find((g) => g.id === "w1")).toBeDefined();
  });

  it("setActiveGroup updates the active group for a workspace", () => {
    useWorkbench.getState().addWorkspace(freshWorkspace("w1"));
    const id = useWorkbench.getState().addTerminalGroup("w1");
    useWorkbench.getState().setActiveGroup("w1", "w1");
    expect(useWorkbench.getState().activeGroupByWorkspace.w1).toBe("w1");
    useWorkbench.getState().setActiveGroup("w1", id);
    expect(useWorkbench.getState().activeGroupByWorkspace.w1).toBe(id);
  });

  it("removeWorkspace drops all groups, trees and active-group entry", () => {
    useWorkbench.getState().addWorkspace(freshWorkspace("w1"));
    const id = useWorkbench.getState().addTerminalGroup("w1");
    useWorkbench.getState().removeWorkspace("w1");
    expect(useWorkbench.getState().terminalGroups).toEqual([]);
    expect(useWorkbench.getState().splitTrees[id]).toBeUndefined();
    expect(useWorkbench.getState().activeGroupByWorkspace.w1).toBeUndefined();
  });

  it("setWorkspaces seeds primary groups and prunes stale ones", () => {
    useWorkbench.getState().addWorkspace(freshWorkspace("w1"));
    useWorkbench.getState().addTerminalGroup("w1");
    useWorkbench.getState().setWorkspaces([freshWorkspace("w2")]);
    const groups = useWorkbench.getState().terminalGroups;
    expect(groups).toEqual([{ id: "w2", workspaceId: "w2", title: "Terminal 1" }]);
    expect(useWorkbench.getState().activeGroupByWorkspace.w1).toBeUndefined();
    expect(useWorkbench.getState().activeGroupByWorkspace.w2).toBe("w2");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `bun run test -- src/state/store.test.ts`
Expected: FAIL (`addTerminalGroup is not a function`, etc.)

- [ ] **Step 3: Implement in `src/state/store.ts`**

Add the type near `TerminalTab` (line ~31):

```ts
export interface TerminalGroup {
  id: string;
  workspaceId: string;
  title: string;
}
```

Add to `WorkbenchState` interface (near the per-workspace state block ~line 92):

```ts
  terminalGroups: TerminalGroup[];
  activeGroupByWorkspace: Record<string, string>;
  addTerminalGroup: (workspaceId: string) => string;
  closeTerminalGroup: (groupId: string) => void;
  setActiveGroup: (workspaceId: string, groupId: string) => void;
```

Initial state (near line 218): `terminalGroups: [], activeGroupByWorkspace: {},`.

Add a module-private helper above `useWorkbench`:

```ts
const primaryGroup = (workspaceId: string): TerminalGroup => ({
  id: workspaceId,
  workspaceId,
  title: "Terminal 1",
});
```

In `addWorkspace`, also seed the primary group + active pointer:

```ts
    addWorkspace: (workspace) =>
      set((s) => ({
        workspaces: [...s.workspaces, workspace],
        workspaceAccessOrder: [
          workspace.id,
          ...s.workspaceAccessOrder.filter((wid) => wid !== workspace.id),
        ],
        terminalGroups: s.terminalGroups.some((g) => g.id === workspace.id)
          ? s.terminalGroups
          : [...s.terminalGroups, primaryGroup(workspace.id)],
        activeGroupByWorkspace: {
          ...s.activeGroupByWorkspace,
          [workspace.id]: s.activeGroupByWorkspace[workspace.id] ?? workspace.id,
        },
      })),
```

In `setWorkspaces`, rebuild groups + active map:

```ts
    setWorkspaces: (workspaces) =>
      set((s) => {
        const ids = new Set(workspaces.map((w) => w.id));
        const kept = s.terminalGroups.filter((g) => ids.has(g.workspaceId));
        const groups = [...kept];
        const active: Record<string, string> = {};
        for (const w of workspaces) {
          if (!groups.some((g) => g.id === w.id)) groups.push(primaryGroup(w.id));
          active[w.id] = ids.has(s.activeGroupByWorkspace[w.id] ? "" : "")
            ? s.activeGroupByWorkspace[w.id]
            : s.activeGroupByWorkspace[w.id] && groups.some((g) => g.id === s.activeGroupByWorkspace[w.id])
              ? s.activeGroupByWorkspace[w.id]
              : w.id;
        }
        return {
          workspaces,
          workspaceAccessOrder: s.workspaceAccessOrder.filter((wid) => ids.has(wid)),
          terminalGroups: groups,
          activeGroupByWorkspace: active,
        };
      }),
```

> Simplify the `active[w.id]` line to: `const existing = s.activeGroupByWorkspace[w.id]; active[w.id] = existing && groups.some((g) => g.id === existing) ? existing : w.id;`

In `removeWorkspace`, inside the `set((s) => {...})` block, drop groups/trees/active entry. Replace the returned object's `splitTrees` handling to also strip extra-group trees:

```ts
      set((s) => {
        const { [id]: _spec, ...launchSpecs } = s.launchSpecs;
        const { [id]: _aspec, ...agentLaunchSpecs } = s.agentLaunchSpecs;
        const groupIds = s.terminalGroups.filter((g) => g.workspaceId === id).map((g) => g.id);
        const splitTrees = Object.fromEntries(
          Object.entries(s.splitTrees).filter(([k]) => !groupIds.includes(k))
        );
        const { [id]: _ag, ...activeGroupByWorkspace } = s.activeGroupByWorkspace;
        return {
          workspaces: s.workspaces.filter((w) => w.id !== id),
          activeWorkspaceId: s.activeWorkspaceId === id ? null : s.activeWorkspaceId,
          workspaceAccessOrder: s.workspaceAccessOrder.filter((wid) => wid !== id),
          terminalGroups: s.terminalGroups.filter((g) => g.workspaceId !== id),
          activeGroupByWorkspace,
          launchSpecs,
          agentLaunchSpecs,
          splitTrees,
          pendingAiRename: s.pendingAiRename.filter((wid) => wid !== id),
        };
      });
```

Add the three new actions near the split-tree actions (~line 307):

```ts
    addTerminalGroup: (workspaceId) => {
      const id = `term-${crypto.randomUUID()}`;
      set((s) => {
        const count = s.terminalGroups.filter((g) => g.workspaceId === workspaceId).length;
        return {
          terminalGroups: [...s.terminalGroups, { id, workspaceId, title: `Terminal ${count + 1}` }],
          activeGroupByWorkspace: { ...s.activeGroupByWorkspace, [workspaceId]: id },
        };
      });
      return id;
    },
    closeTerminalGroup: (groupId) =>
      set((s) => {
        const group = s.terminalGroups.find((g) => g.id === groupId);
        if (!group || group.id === group.workspaceId) return {};
        const siblings = s.terminalGroups.filter((g) => g.workspaceId === group.workspaceId && g.id !== groupId);
        const fallback = siblings[siblings.length - 1]?.id ?? group.workspaceId;
        const { [groupId]: _tree, ...splitTrees } = s.splitTrees;
        return {
          terminalGroups: s.terminalGroups.filter((g) => g.id !== groupId),
          splitTrees,
          activeGroupByWorkspace:
            s.activeGroupByWorkspace[group.workspaceId] === groupId
              ? { ...s.activeGroupByWorkspace, [group.workspaceId]: fallback }
              : s.activeGroupByWorkspace,
        };
      }),
    setActiveGroup: (workspaceId, groupId) =>
      set((s) => ({ activeGroupByWorkspace: { ...s.activeGroupByWorkspace, [workspaceId]: groupId } })),
```

Add the selector near the other selectors (~line 558):

```ts
export const selectWorkspaceGroups =
  (workspaceId: string) =>
  (s: WorkbenchState): TerminalGroup[] =>
    s.terminalGroups.filter((g) => g.workspaceId === workspaceId);
```

- [ ] **Step 4: Run tests, verify pass**

Run: `bun run test -- src/state/store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/state/store.ts src/state/store.test.ts
git commit -m "feat(store): per-workspace terminal groups"
```

---

## Task 2: leaf-registry — kill leaves for all groups

**Files:**
- Modify: `src/components/editor/terminal/leaf-registry.ts`
- Modify: `src/state/store.ts` (removeWorkspace), `src/hooks/useWorkspace.ts` (destroy)
- Test: `src/components/editor/terminal/leaf-registry.test.ts` (create if absent), `src/state/store.test.ts`

**Interfaces:**
- Produces: `killTerminalGroupLeaves(groupId: string): void` — kills every `${groupId}-*` leaf PTY.
- Consumes: existing `leafPtyCache`, `killLeaf`, `killWorkspaceLeaves`.

**Notes:** `killWorkspaceLeaves(workspaceId)` only kills `${workspaceId}-*` — i.e. the primary group's leaves. Extra groups have `term-uuid-*` leaves that would leak on destroy. Fix by killing each group's leaves explicitly at the call sites that own the group list (store + useWorkspace), since the registry has no access to the group list.

- [ ] **Step 1: Write failing test**

Create `src/components/editor/terminal/leaf-registry.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/tauri", () => ({ ptyKill: vi.fn(() => Promise.resolve()) }));
import { ptyKill } from "@/lib/tauri";
import { killTerminalGroupLeaves, __testing__ } from "./leaf-registry";

beforeEach(() => {
  __testing__.leafPtyCache.clear();
  vi.mocked(ptyKill).mockClear();
});

it("kills only the target group's leaves", () => {
  __testing__.leafPtyCache.set("term-abc-1", "pty1");
  __testing__.leafPtyCache.set("term-abc-2", "pty2");
  __testing__.leafPtyCache.set("w1-1", "pty3");
  killTerminalGroupLeaves("term-abc");
  expect(ptyKill).toHaveBeenCalledTimes(2);
  expect(__testing__.leafPtyCache.has("term-abc-1")).toBe(false);
  expect(__testing__.leafPtyCache.has("w1-1")).toBe(true);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `bun run test -- src/components/editor/terminal/leaf-registry.test.ts`
Expected: FAIL (`killTerminalGroupLeaves` not exported)

- [ ] **Step 3: Implement**

In `leaf-registry.ts`, generalize the prefix-kill and keep `killWorkspaceLeaves` delegating to it:

```ts
/** Kill every leaf shell PTY belonging to a terminal group (ids are `${groupId}-…`). */
export function killTerminalGroupLeaves(groupId: string): void {
  const prefix = `${groupId}-`;
  for (const leafId of [...leafPtyCache.keys()]) {
    if (leafId.startsWith(prefix)) killLeaf(leafId);
  }
}

/** Kill the PRIMARY group's leaves (group id === workspace id). Extra groups are killed by the store. */
export function killWorkspaceLeaves(workspaceId: string): void {
  killTerminalGroupLeaves(workspaceId);
}
```

In `src/state/store.ts` `removeWorkspace`, before the `set(...)`, kill all groups' leaves:

```ts
    removeWorkspace: (id) => {
      disposeWorkspaceRunners(id);
      for (const g of get().terminalGroups.filter((gr) => gr.workspaceId === id)) {
        killTerminalGroupLeaves(g.id);
      }
      useAgentStatusStore.getState().clearStatus(id);
      set((s) => { /* …unchanged from Task 1… */ });
    },
```

Update the import in `store.ts` line 5 to include the new function:

```ts
import { killTerminalGroupLeaves } from "@/components/editor/terminal/leaf-registry";
```

(Remove the now-unused `killWorkspaceLeaves` import from `store.ts`.)

In `src/hooks/useWorkspace.ts` `destroy`, kill all groups' leaves (not just primary):

```ts
  const destroy = useCallback(
    async (workspaceId: string) => {
      for (const g of useWorkbench.getState().terminalGroups.filter((gr) => gr.workspaceId === workspaceId)) {
        killTerminalGroupLeaves(g.id);
      }
      await workspaceDestroy(workspaceId);
      removeWorkspace(workspaceId);
    },
    [removeWorkspace]
  );
```

Update `useWorkspace.ts` import line 13 to `import { killTerminalGroupLeaves } from "@/components/editor/terminal/leaf-registry";`.

- [ ] **Step 4: Add a store test asserting destroy kills extra-group leaves**

`store.test.ts` does NOT mock leaf-registry — it uses the REAL registry via `__testing__.leafPtyCache` and asserts eviction (`invoke("pty_kill", …)` is mocked). Match that existing pattern (see the test "removeWorkspace kills the workspace's leaf shell PTYs (#17)"). Add:

```ts
it("removeWorkspace kills leaves for extra terminal groups too", async () => {
  const { __testing__ } = await import("@/components/editor/terminal/leaf-registry");
  useWorkbench.getState().addWorkspace(makeWorkspace({ id: "w1" }));
  const id = useWorkbench.getState().addTerminalGroup("w1");
  __testing__.leafPtyCache.set("w1-1", "pty-primary");
  __testing__.leafPtyCache.set(`${id}-1`, "pty-extra");
  useWorkbench.getState().removeWorkspace("w1");
  expect(__testing__.leafPtyCache.has("w1-1")).toBe(false);
  expect(__testing__.leafPtyCache.has(`${id}-1`)).toBe(false);
});
```

> No `vi.mock` of leaf-registry is needed or wanted. The existing `#17` test still passes because `setWorkspaces([makeWorkspace({id:"w-pty"})])` now seeds a primary group `{id:"w-pty"}`, so `removeWorkspace` calls `killTerminalGroupLeaves("w-pty")` which evicts the `w-pty-*` leaves.

- [ ] **Step 5: Run tests, verify pass**

Run: `bun run test -- src/state/store.test.ts src/components/editor/terminal/leaf-registry.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/editor/terminal/leaf-registry.ts src/components/editor/terminal/leaf-registry.test.ts src/state/store.ts src/state/store.test.ts src/hooks/useWorkspace.ts
git commit -m "feat(terminal): kill leaves for every terminal group on destroy"
```

---

## Task 3: FileTab gains workspaceId

**Files:**
- Modify: `src/state/store.ts` (`FileTab`, `openFileTab`)
- Test: `src/state/store.filetabs.test.ts`

**Interfaces:**
- Produces: `FileTab.workspaceId: string | null`; `openFileTab` derives it from `worktreePath`.
- Consumes: `selectContextWorkspace` (unchanged — still works via worktreePath).

**Notes:** Derive inside `openFileTab` so the ~15 call sites are untouched. `null` when no workspace matches the worktree path.

- **Update the local `makeTab` helper in `src/state/store.test.ts`** (lines ~15-28) and any other `FileTab` literal in tests to include `workspaceId: null` by default, so the new required field type-checks. Other test files that construct `FileTab` literals (grep `kind: "file"` / `worktreePath:` in `*.test.tsx`) must add `workspaceId` — the compiler in Task 8 will catch any missed ones; fix them there if not here.

- [ ] **Step 1: Write failing test**

Add to `src/state/store.filetabs.test.ts`:

```ts
it("openFileTab stamps the owning workspaceId from worktreePath", () => {
  useWorkbench.setState({
    workspaces: [{ id: "w1", projectId: "p", branch: "b", agentBackend: "claude", worktreePath: "/wt/w1", status: "active", sessionId: "s" }],
    fileTabs: [], activeFileTabId: null, fileTabAccessOrder: [],
  });
  useWorkbench.getState().openFileTab({ kind: "file", path: "/wt/w1/a.ts", worktreePath: "/wt/w1", preview: true });
  const tab = useWorkbench.getState().fileTabs[0];
  expect(tab.workspaceId).toBe("w1");
});

it("openFileTab sets workspaceId null when no workspace matches", () => {
  useWorkbench.setState({ workspaces: [], fileTabs: [], activeFileTabId: null, fileTabAccessOrder: [] });
  useWorkbench.getState().openFileTab({ kind: "file", path: "/x/a.ts", worktreePath: "/x", preview: true });
  expect(useWorkbench.getState().fileTabs[0].workspaceId).toBeNull();
});
```

- [ ] **Step 2: Run, verify fail**

Run: `bun run test -- src/state/store.filetabs.test.ts`
Expected: FAIL (`workspaceId` undefined)

- [ ] **Step 3: Implement**

Add to `FileTab` (line ~55): `workspaceId: string | null;`

In `openFileTab`, compute it once at the top of the `set` callback and include it on the new `tab` object:

```ts
        const workspaceId = s.workspaces.find((w) => w.worktreePath === input.worktreePath)?.id ?? null;
        const tab: FileTab = {
          id, kind: input.kind, path: input.path, worktreePath: input.worktreePath,
          workspaceId, viewerId: input.viewerId, preview: input.preview,
          dirty: false, mode: defaultMode, viewed: false,
        };
```

- [ ] **Step 4: Run tests, verify pass**

Run: `bun run test -- src/state/store.filetabs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/state/store.ts src/state/store.filetabs.test.ts
git commit -m "feat(store): stamp owning workspaceId on file tabs"
```

---

## Task 4: TerminalView keyed by group id

**Files:**
- Modify: `src/components/editor/terminal/TerminalView.tsx`
- Test: `src/components/editor/terminal/TerminalView.test.tsx`

**Interfaces:**
- Produces: `TerminalView` props become `{ workspace: Workspace; groupId: string; visible?: boolean }`. All `splitTrees` keys and leaf-id prefixes use `groupId` instead of `workspace.id`. cwd/backend still come from `workspace`.
- Consumes: `splitTrees[groupId]`, `setSplitTree(groupId, tree)`.

**Notes:** For the primary group `groupId === workspace.id`, so behavior is byte-identical to today. Replace every `workspace.id` used as a *tree/leaf key* with `groupId`; keep `workspace` for backend/cwd/SplitGrid. `data-testid` becomes `terminal-view-${groupId}`.

- [ ] **Step 1: Update/extend the test**

In `src/components/editor/terminal/TerminalView.test.tsx`, pass the new `groupId` prop in renders and assert keying. Add:

```ts
it("seeds and reads the split tree under groupId, not workspace.id", () => {
  const ws = { id: "w1", projectId: "p", branch: "b", agentBackend: "claude", worktreePath: "/wt", status: "active" as const, sessionId: "s" };
  render(<TerminalView workspace={ws} groupId="term-x" visible />);
  expect(useWorkbench.getState().splitTrees["term-x"]).toBeDefined();
  expect(useWorkbench.getState().splitTrees["term-x"].id).toBe("term-x-1");
});
```

Update existing renders in this file to include `groupId={ws.id}` and any `terminal-view-${ws.id}` testid expectations stay valid for the primary case.

- [ ] **Step 2: Run, verify fail**

Run: `bun run test -- src/components/editor/terminal/TerminalView.test.tsx`
Expected: FAIL (prop/type error or missing tree under `term-x`)

- [ ] **Step 3: Implement**

Change the signature and body of `TerminalView.tsx`:

```tsx
interface Props {
  workspace: Workspace;
  groupId: string;
  visible?: boolean;
}

function singlePane(groupId: string, backend: string): SplitNode {
  return { type: "terminal", id: `${groupId}-1`, backend, ptyId: groupId };
}

export function TerminalView({ workspace, groupId, visible = true }: Props) {
  const tree = useWorkbench((s) => s.splitTrees[groupId]);
  const setSplitTree = useWorkbench((s) => s.setSplitTree);
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null);

  useEffect(() => {
    if (!tree) setSplitTree(groupId, singlePane(groupId, workspace.agentBackend));
  }, [tree, groupId, workspace.agentBackend, setSplitTree]);
  // …
}
```

Then in the split/close/focus handlers replace `workspace.id` → `groupId` for: `useWorkbench.getState().splitTrees[groupId]`, `const newId = ${groupId}-${Date.now()}`, the new SplitNode `ptyId: groupId`, `setSplitTree(groupId, …)`, `singlePane(groupId, workspace.agentBackend)`, and `data-testid={`terminal-view-${groupId}`}`. Keep `SplitGrid` receiving `workspace` (for backend/cwd). Update the effect dependency arrays from `workspace`/`workspace.id` to `groupId` (+ `workspace.agentBackend` where the backend is read).

- [ ] **Step 4: Run tests, verify pass**

Run: `bun run test -- src/components/editor/terminal/TerminalView.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/terminal/TerminalView.tsx src/components/editor/terminal/TerminalView.test.tsx
git commit -m "refactor(terminal): key TerminalView by group id"
```

---

## Task 5: WorkspaceEditor renders per-group TerminalViews

**Files:**
- Modify: `src/components/editor/WorkspaceEditor.tsx`
- Test: `src/components/editor/WorkspaceEditor.test.tsx`

**Interfaces:**
- Consumes: `selectWorkspaceGroups(workspace.id)`, `activeGroupByWorkspace[workspace.id]`, `TerminalView` (Task 4).
- Produces: one keep-alive `TerminalView` per terminal group; only the workspace's active group is `visible`.

**Notes:** A group is visible iff the workspace editor is `active` AND it is the workspace's active group. Inactive groups stay mounted (`keep-alive-hidden`) with `visible=false` so PTYs survive and renderer slots release.

- [ ] **Step 1: Write failing test**

Replace/extend `src/components/editor/WorkspaceEditor.test.tsx`:

```tsx
it("mounts every group, shows only the active one", () => {
  const ws = { id: "w1", projectId: "p", branch: "b", agentBackend: "claude", worktreePath: "/wt", status: "active" as const, sessionId: "s" };
  useWorkbench.setState({
    workspaces: [ws],
    terminalGroups: [
      { id: "w1", workspaceId: "w1", title: "Terminal 1" },
      { id: "term-2", workspaceId: "w1", title: "Terminal 2" },
    ],
    activeGroupByWorkspace: { w1: "term-2" },
    splitTrees: {},
  });
  render(<WorkspaceEditor workspace={ws} active />);
  expect(screen.getByTestId("terminal-view-w1")).toBeInTheDocument();
  expect(screen.getByTestId("terminal-view-term-2")).toBeInTheDocument();
  expect(screen.getByTestId("terminal-group-w1").getAttribute("aria-hidden")).toBe("true");
  expect(screen.getByTestId("terminal-group-term-2").getAttribute("aria-hidden")).toBe("false");
});
```

- [ ] **Step 2: Run, verify fail**

Run: `bun run test -- src/components/editor/WorkspaceEditor.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement**

```tsx
import type { Workspace } from "@/lib/ipc";
import { useWorkbench, selectWorkspaceGroups } from "@/state/store";
import { TerminalView } from "./terminal/TerminalView";
import { useAutomationTriggers } from "@/hooks/useAutomationTriggers";
import { useAgentRun } from "@/hooks/useAgentRun";
import { cn } from "@/lib/utils";

interface Props { workspace: Workspace; active: boolean; }

export function WorkspaceEditor({ workspace, active }: Props) {
  useAutomationTriggers(workspace);
  useAgentRun(workspace);
  const groups = useWorkbench(selectWorkspaceGroups(workspace.id));
  const activeGroupId = useWorkbench((s) => s.activeGroupByWorkspace[workspace.id]) ?? workspace.id;
  return (
    <div
      data-testid={`workspace-editor-${workspace.id}`}
      data-active={active ? "true" : "false"}
      className={cn("mv-workspace-editor absolute inset-0 flex flex-col bg-editor", !active && "keep-alive-hidden content-visibility-auto")}
      aria-hidden={!active}
    >
      {groups.map((g) => {
        const groupActive = active && g.id === activeGroupId;
        return (
          <div
            key={g.id}
            data-testid={`terminal-group-${g.id}`}
            aria-hidden={!groupActive}
            className={cn("absolute inset-0", !groupActive && "keep-alive-hidden content-visibility-auto")}
          >
            <TerminalView workspace={workspace} groupId={g.id} visible={groupActive} />
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `bun run test -- src/components/editor/WorkspaceEditor.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/WorkspaceEditor.tsx src/components/editor/WorkspaceEditor.test.tsx
git commit -m "feat(editor): render per-group terminals in WorkspaceEditor"
```

---

## Task 6: EditorGroup — remove standalone terminals, keep file-tab LRU

**Files:**
- Modify: `src/components/editor/EditorGroup.tsx`
- Test: `src/components/editor/EditorGroup.test.tsx`

**Interfaces:**
- Consumes: `workspaces`, `activeWorkspaceId`, `activeFileTabId`, `activeSystemTab`, `fileTabs`, `liveFileTabIds`, `liveIds`.
- Removes: all references to `terminalTabs`, `activeTerminalTabId`, `setActiveTerminalTab`, and the standalone-terminal JSX block + `TerminalPane` import.

**Notes:** `hasAnyTabs` and `showEmpty` lose the `terminalTabs` term. `showTerminalTab` is removed; `WorkspaceEditor active` becomes `!showSystemTab && !showFileTab && ws.id === activeId`. File-tab block is unchanged (still LRU, still keyed by `activeFileTabId`).

- [ ] **Step 1: Update tests**

In `src/components/editor/EditorGroup.test.tsx`, remove/replace assertions about standalone terminal tabs. Add:

```tsx
it("does not render standalone terminal tab content", () => {
  // After folding, terminalTabs no longer exists in state.
  useWorkbench.setState({ workspaces: [], systemTabs: [], fileTabs: [], activeWorkspaceId: null });
  render(<EditorGroup />);
  expect(screen.queryByTestId(/terminal-tab-content-/)).toBeNull();
});
```

- [ ] **Step 2: Run, verify fail/compile-error**

Run: `bun run test -- src/components/editor/EditorGroup.test.tsx`
Expected: FAIL (old terminalTabs assertions / references)

- [ ] **Step 3: Implement**

In `EditorGroup.tsx`: delete lines reading `terminalTabs`, `activeTerminalTabId`, `setActiveTerminalTab` (52–54), the `TerminalPane` import (7), the standalone-terminal JSX block (105–134), and the `showTerminalTab` const (68–69). Update:

```tsx
const hasAnyTabs = workspaces.length > 0 || systemTabs.length > 0 || fileTabs.length > 0;
// …
<WorkspaceEditor key={ws.id} workspace={ws} active={!showSystemTab && !showFileTab && ws.id === activeId} />
```

- [ ] **Step 4: Run tests, verify pass**

Run: `bun run test -- src/components/editor/EditorGroup.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/EditorGroup.tsx src/components/editor/EditorGroup.test.tsx
git commit -m "refactor(editor): drop standalone terminal tabs from EditorGroup"
```

---

## Task 7: EditorTabs — chips + scoped group/file tabs + group-aware "+"

**Files:**
- Modify: `src/components/editor/EditorTabs.tsx`
- Test: `src/components/editor/EditorTabs.test.tsx`

**Interfaces:**
- Consumes: `workspaces`, `activeWorkspaceId`, `fileTabs`, `activeFileTabId`, `terminalGroups`, `activeGroupByWorkspace`, `setActiveWorkspace`, `setActiveGroup`, `addTerminalGroup`, `closeTerminalGroup`, `selectWorkspaceGroups`.
- Removes: standalone-terminal rendering + `useTerminalTab` usage for tab rendering; `onNewTerminal`/standalone state.

**Notes:**
- `contextWorkspaceId = activeWorkspaceId ?? fileTabs.find(t => t.id === activeFileTabId)?.workspaceId ?? null`.
- Render order: system tabs (unchanged), **workspace chips** (all, via `EditorTab`, highlight `ws.id === activeId`), then for the context workspace: **terminal-group tabs** then **file tabs** (filtered to `t.workspaceId === contextWorkspaceId`).
- Terminal-group tab: clicking selects the workspace + group: `setActiveWorkspace(ws); setActiveGroup(ws, groupId)`. Active iff `activeWorkspaceId === contextWs && !activeFileTabId && !activeSystemTab && activeGroupByWorkspace[ws] === groupId`. Close button only when the workspace has ≥2 groups AND `groupId !== ws` (primary has no X).
- `+` button: `addTerminalGroup(contextWorkspaceId)` when one exists; disabled otherwise. Keep the existing dropdown's system-view items; replace the "New Terminal" item with one that calls `addTerminalGroup(contextWorkspaceId)`. Remove the WSL/shell-kind machinery only if it becomes dead (it may still be used by the Panel terminal — verify; if so, leave `availableShells`/`wslAvailable` imports used by other code untouched, but remove the now-unused branches in this file).
- `⌘W` handler: replace the `activeTerminalTabId` branch. New order: file tab → system tab → (workspace) if active group is non-primary and has splits, close pane; else if active group is non-primary, `closeTerminalGroup`; else (primary) close pane if splits>1 else `removeWorkspace`.

- [ ] **Step 1: Write failing tests**

In `src/components/editor/EditorTabs.test.tsx` add:

```tsx
function seed() {
  useWorkbench.setState({
    workspaces: [
      { id: "w1", projectId: "p", branch: "b1", agentBackend: "claude", worktreePath: "/wt/w1", status: "active", sessionId: "s", title: "A" },
      { id: "w2", projectId: "p", branch: "b2", agentBackend: "claude", worktreePath: "/wt/w2", status: "active", sessionId: "s", title: "B" },
    ],
    activeWorkspaceId: "w1",
    terminalGroups: [
      { id: "w1", workspaceId: "w1", title: "Terminal 1" },
      { id: "term-2", workspaceId: "w1", title: "Terminal 2" },
      { id: "w2", workspaceId: "w2", title: "Terminal 1" },
    ],
    activeGroupByWorkspace: { w1: "w1", w2: "w2" },
    fileTabs: [
      { id: "file:/wt/w1/a.ts", kind: "file", path: "/wt/w1/a.ts", worktreePath: "/wt/w1", workspaceId: "w1", preview: false, dirty: false, mode: "edit", viewed: false },
      { id: "file:/wt/w2/b.ts", kind: "file", path: "/wt/w2/b.ts", worktreePath: "/wt/w2", workspaceId: "w2", preview: false, dirty: false, mode: "edit", viewed: false },
    ],
    activeFileTabId: null, activeSystemTab: null, systemTabs: [], fileTabAccessOrder: [],
  });
}

it("shows both workspace chips but only the active workspace's group + file tabs", () => {
  seed();
  render(<EditorTabs />);
  expect(screen.getByTestId("editor-tab-w1")).toBeInTheDocument();
  expect(screen.getByTestId("editor-tab-w2")).toBeInTheDocument();
  expect(screen.getByTestId("editor-tab-group-w1")).toBeInTheDocument();
  expect(screen.getByTestId("editor-tab-group-term-2")).toBeInTheDocument();
  expect(screen.queryByTestId("editor-tab-group-w2")).toBeNull();
  expect(screen.getByText("a.ts")).toBeInTheDocument();
  expect(screen.queryByText("b.ts")).toBeNull();
});

it("primary group tab has no close button; extra group does", () => {
  seed();
  render(<EditorTabs />);
  expect(screen.queryByLabelText("Close Terminal 1")).toBeNull();
  expect(screen.getByLabelText("Close Terminal 2")).toBeInTheDocument();
});

it("+ adds a terminal group to the context workspace", async () => {
  seed();
  render(<EditorTabs />);
  await userEvent.click(screen.getByTestId("editor-tabs-add-terminal"));
  expect(useWorkbench.getState().terminalGroups.filter((g) => g.workspaceId === "w1")).toHaveLength(3);
});
```

> The `EditorTab` component must expose `data-testid={`editor-tab-${ws.id}`}` — verify/add in `EditorTab.tsx` if missing (it currently may use a different testid; align it).

- [ ] **Step 2: Run, verify fail**

Run: `bun run test -- src/components/editor/EditorTabs.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement**

Replace the standalone-terminal block (233–271) with a terminal-group block, scope the file-tab map, and add the `+` terminal button. Key fragments:

```tsx
const terminalGroups = useWorkbench((s) => s.terminalGroups);
const activeGroupByWorkspace = useWorkbench((s) => s.activeGroupByWorkspace);
const setActiveGroup = useWorkbench((s) => s.setActiveGroup);
const addTerminalGroup = useWorkbench((s) => s.addTerminalGroup);
const closeTerminalGroup = useWorkbench((s) => s.closeTerminalGroup);

const contextWorkspaceId =
  activeId ?? fileTabs.find((t) => t.id === activeFileTabId)?.workspaceId ?? null;
const ctxGroups = terminalGroups.filter((g) => g.workspaceId === contextWorkspaceId);
const ctxFileTabs = fileTabs.filter((t) => t.workspaceId === contextWorkspaceId);
```

Group-tab JSX (after the workspace chips `.map`):

```tsx
{ctxGroups.map((g) => {
  const active =
    activeId === contextWorkspaceId && !activeFileTabId && !activeSystemTab &&
    (activeGroupByWorkspace[contextWorkspaceId!] ?? contextWorkspaceId) === g.id;
  const closable = g.id !== g.workspaceId && ctxGroups.length > 1;
  return (
    <button
      key={g.id}
      type="button"
      data-testid={`editor-tab-group-${g.id}`}
      onClick={() => { setActiveWorkspace(g.workspaceId); setActiveGroup(g.workspaceId, g.id); }}
      className={cn(
        "group relative flex min-w-[110px] items-center gap-1.5 px-3 text-[12px] transition-colors duration-100",
        active ? "bg-tab-active text-tab-fg-active" : "bg-tab-inactive text-tab-fg hover:bg-foreground/5 hover:text-foreground"
      )}
    >
      <TerminalSquare className="h-3.5 w-3.5 shrink-0 opacity-70" />
      <span className="flex-1 truncate text-left">{g.title}</span>
      {closable && (
        <span
          role="button" tabIndex={0} aria-label={`Close ${g.title}`}
          onClick={(e) => { e.stopPropagation(); closeTerminalGroup(g.id); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); closeTerminalGroup(g.id); } }}
          className="flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 data-[active=true]:opacity-60"
          data-active={active}
        >
          <X className="h-3 w-3" />
        </span>
      )}
    </button>
  );
})}
```

Change the file-tab `.map` source from `fileTabs` to `ctxFileTabs`.

Add a `+` terminal button in the right-hand controls (before the existing dropdown), gated on `contextWorkspaceId`:

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <button
      type="button" aria-label="New terminal"
      data-testid="editor-tabs-add-terminal"
      disabled={!contextWorkspaceId}
      onClick={() => contextWorkspaceId && addTerminalGroup(contextWorkspaceId)}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-sidebar-hover hover:text-foreground disabled:opacity-40"
    >
      <TerminalSquare className="h-4 w-4" />
    </button>
  </TooltipTrigger>
  <TooltipContent side="bottom">New terminal in workspace</TooltipContent>
</Tooltip>
```

Remove `useTerminalTab`, `onNewTerminal`, the standalone `terminalTabs`/`activeTerminalTabId`/`setActiveTerminalTab` reads, and the now-dead "New Terminal" dropdown item. In the dropdown, keep "New Terminal in Panel" and the "Open as tab" system-view items. Update the `⌘W` handler `onCloseActiveTab`:

```tsx
function onCloseActiveTab() {
  const s = useWorkbench.getState();
  if (s.activeFileTabId) {
    if (!closeFileTab(s.activeFileTabId)) setConfirmCloseId(s.activeFileTabId);
  } else if (s.activeSystemTab) {
    closeSystemTab(s.activeSystemTab);
  } else if (s.activeWorkspaceId) {
    const ws = s.activeWorkspaceId;
    const groupId = s.activeGroupByWorkspace[ws] ?? ws;
    const tree = s.splitTrees[groupId];
    if (tree && countLeaves(tree) > 1) {
      window.dispatchEvent(new CustomEvent("maverick:terminal:closePane"));
    } else if (groupId !== ws) {
      s.closeTerminalGroup(groupId);
    } else {
      removeWorkspace(ws);
    }
  }
}
```

Update the effect's dependency array (drop `closeTerminal`).

- [ ] **Step 4: Run tests, verify pass**

Run: `bun run test -- src/components/editor/EditorTabs.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/EditorTabs.tsx src/components/editor/EditorTabs.test.tsx src/components/editor/EditorTab.tsx
git commit -m "feat(editor): scope tabs to workspace + group-aware new-terminal"
```

---

## Task 8: Remove dead standalone-terminal code + full green

**Files:**
- Modify: `src/state/store.ts` (remove `TerminalTab`, `terminalTabs`, `activeTerminalTabId`, `addTerminalTab`, `removeTerminalTab`, `setActiveTerminalTab`, `setTerminalTabPty`)
- Delete: `src/hooks/useTerminalTab.ts`, `src/hooks/useTerminalTab.test.ts`
- Modify: any remaining importer flagged by the build/grep (e.g. `TerminalPane` standalone usages, `default-cwd` if now unused, `store.test.ts`)
- Test: full suite + typecheck + build

**Interfaces:**
- Removes the standalone `TerminalTab` API entirely. `TerminalPane` itself stays (still used inside `SplitGrid`/`TerminalLeaf`? verify — if only the standalone path used it, keep the file; do not delete shared terminal primitives).

**Notes:** This is the cleanup task — only mechanical deletions guided by the compiler. Do it last so earlier tasks stayed green.

- [ ] **Step 1: Find remaining references**

Run: `grep -rn "terminalTabs\|activeTerminalTabId\|setActiveTerminalTab\|addTerminalTab\|removeTerminalTab\|setTerminalTabPty\|useTerminalTab\b" src`
Expected: only `store.ts`, deleted hook, and their tests.

- [ ] **Step 2: Delete the standalone API**

Remove from `store.ts`: the `TerminalTab` interface, the four state fields/actions in the interface, their initial state, and the four action implementations (`addTerminalTab`, `setTerminalTabPty`, `removeTerminalTab`, `setActiveTerminalTab`). Delete `src/hooks/useTerminalTab.ts` and `src/hooks/useTerminalTab.test.ts`. Remove the standalone-terminal cases from `store.test.ts`.

```bash
git rm src/hooks/useTerminalTab.ts src/hooks/useTerminalTab.test.ts
```

- [ ] **Step 3: Fix fallout, typecheck**

Run: `bun run build`
Expected: PASS (fix any dangling imports the compiler flags — e.g. remove `defaultTerminalCwd` import in `EditorTabs.tsx` if unused; leave `default-cwd.ts` if other code imports it).

- [ ] **Step 4: Full test suite + coverage**

Run: `bun run test:coverage`
Expected: PASS, thresholds met (lines 100 / branches 95 / functions 100 / statements 100). Add focused tests for any uncovered new branches (e.g. `addTerminalGroup` when `contextWorkspaceId` null path in EditorTabs, `closeTerminalGroup` fallback to primary).

- [ ] **Step 5: Manual smoke (per CLAUDE.md "done")**

Run: `bun run tauri dev`. Verify: create two worktrees; each shows its own terminal tab; `+` adds claude② in the active workspace; switching workspaces swaps the tab cluster; opening a file in A then switching to B hides A's file tab; closing an extra terminal tab kills its PTY; destroying a workspace kills all its PTYs.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(editor): remove dead standalone-terminal code"
```

---

## Self-Review Notes (author)

- **Spec coverage:** terminal groups (T1,4,5), leaf cleanup (T2), file-tab scoping (T3,6,7), EditorTabs UI + `+` + ⌘W (T7), fold/remove standalone (T6,8). Non-goals (persistence, per-workspace system views, drag-reorder) intentionally untouched.
- **Type consistency:** `TerminalGroup`, `terminalGroups`, `activeGroupByWorkspace`, `addTerminalGroup`/`closeTerminalGroup`/`setActiveGroup`, `selectWorkspaceGroups`, `killTerminalGroupLeaves`, `FileTab.workspaceId`, `TerminalView` `groupId` — names identical across tasks.
- **Risk:** primary-group-id === workspace.id keeps `primaryAgentPtyId`/`splitTrees`/presets/ai-actions untouched. Confirm `store.test.ts`'s existing leaf-registry `vi.mock` is updated to export `killTerminalGroupLeaves` (Task 2 Step 4) or unrelated store tests will throw.
