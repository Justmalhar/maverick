# New Workspace UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two separate workspace-creation dialogs with one redesigned `NewWorkspaceDialog` that lets the user pick a coding agent, a base branch, and a branch name in a single flow.

**Architecture:** A new `NewWorkspaceDialog` component composes three shadcn `Select`s (agent + base branch) plus the existing branch-type chips / name input. It reports one `NewWorkspacePayload` to `ProjectsView`, which already has the `create(projectId, branch, backend, baseBranch)` plumbing — the only behavioral change is that `backend` is now user-selected rather than the hardcoded `"claude-code"`. The two old dialogs (`NameWorkspaceDialog`, `CreateFromDialog`) and the project-row "Create from" button are removed.

**Tech Stack:** React + TypeScript, shadcn/ui (`Select`, `Dialog`, `Input`), Tailwind v4 tokens, Zustand (`useWorkbench`), Vitest + @testing-library/react. Package manager: **bun**.

---

## Context the engineer needs

- **Run a single test file:** `bun run test -- src/components/primarysidebar/NewWorkspaceDialog.test.tsx`
- **Run all tests with coverage:** `bun run test:coverage`
- **Type/build check:** `bun run build`
- **Test helpers:** `renderWithProviders`, `screen`, `waitFor` from `@/test/utils`; `makeProject`, `makeBackend` from `@/test/fixtures`. The Tauri `invoke` is auto-mocked (`vi.mocked(invoke)`); set return values per `cmd` string.
- **Radix `Select` in jsdom** already works — `src/test/setup.ts` polyfills `hasPointerCapture` / `scrollIntoView`. To interact: click the trigger by its `data-testid`, then click the option by its visible text via `screen.findByRole("option", { name })` (or `screen.getByText`).
- **Prior art to mirror:** `src/panels/kanban/TaskComposer.tsx` (lines 247-293) — three `Select`s sourcing `projects` / branches / `backends` from `useWorkbench`, default backend = `backends.find(b => b.active)?.id ?? backends[0]?.id`.
- **Branch API:** `gitBranchList(worktreePath: string): Promise<Branch[]>` from `@/lib/tauri`. `Branch = { name: string; isRemote: boolean; isCurrent: boolean; ... }`. Backed by the `git_branch_list` Tauri command.
- **Brand icons:** `brandFor(id: string): BackendBrand | undefined` from `@/lib/backend-brand`. `BackendBrand.Icon` is a `React.ComponentType<{ size?: number }>`, `BackendBrand.label` is the display string.
- **Branch composition:** `composeTypedBranch(type, name)` from `@/lib/branch-name` → `"feature/login-page"`; returns `""` when name is blank.
- **Store actions used in ProjectsView:** `useWorkbench.getState().setLaunchSpec(wsId, { command, args })`, `markPendingAiRename(wsId)`, `queueSetup` (already called inside `create`).
- **Launch resolution:** `resolveStartupLaunch(backendId): { command, args }` from `@/lib/launch`.

## File structure

**Create**
- `src/components/primarysidebar/NewWorkspaceDialog.tsx` — the unified dialog (agent + base branch + branch naming).
- `src/components/primarysidebar/NewWorkspaceDialog.test.tsx` — its unit tests.

**Modify**
- `src/components/primarysidebar/ProjectsView.tsx` — swap two dialogs for one; forward selected `backend`.
- `src/components/primarysidebar/ProjectsView.test.tsx` — update flow tests for the merged dialog + agent select.
- `src/components/primarysidebar/ProjectItem.tsx` — drop the `Link2` "Create from" action and the `onCreateFrom` prop.
- `src/components/primarysidebar/ProjectItem.test.tsx` — remove the "Create from" test.

**Delete**
- `src/components/primarysidebar/NameWorkspaceDialog.tsx` + `NameWorkspaceDialog.test.tsx`
- `src/components/primarysidebar/CreateFromDialog.tsx`

---

## Task 1: Scaffold NewWorkspaceDialog with branch naming (ported from NameWorkspaceDialog)

Build the new dialog with the branch-type chips, name input, live preview, and the two footer actions first. Agent + base-branch selects come in Tasks 2-3. The public payload is final from the start so later tasks only fill fields.

**Files:**
- Create: `src/components/primarysidebar/NewWorkspaceDialog.tsx`
- Test: `src/components/primarysidebar/NewWorkspaceDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/primarysidebar/NewWorkspaceDialog.test.tsx
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { useWorkbench } from "@/state/store";
import { makeBackend } from "@/test/fixtures";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";

const initial = useWorkbench.getState();

function setBackends(backends = [makeBackend({ id: "claude-code", name: "Claude Code", active: true })]) {
  useWorkbench.setState({ ...initial, backends });
}

function setup(over: Partial<React.ComponentProps<typeof NewWorkspaceDialog>> = {}) {
  const onSubmit = vi.fn();
  const onOpenChange = vi.fn();
  renderWithProviders(
    <NewWorkspaceDialog
      open
      onOpenChange={onOpenChange}
      projectName="demo"
      projectPath={null}
      onSubmit={onSubmit}
      {...over}
    />
  );
  return { onSubmit, onOpenChange };
}

describe("NewWorkspaceDialog — branch naming", () => {
  it("Create is disabled until a name is entered", async () => {
    setBackends();
    setup();
    expect(screen.getByTestId("branch-create")).toBeDisabled();
    await userEvent.type(screen.getByTestId("branch-name-input"), "login page");
    expect(screen.getByTestId("branch-create")).toBeEnabled();
  });

  it("composes the chosen type + name and submits it", async () => {
    setBackends();
    const { onSubmit } = setup();
    await userEvent.click(screen.getByTestId("branch-type-fix"));
    await userEvent.type(screen.getByTestId("branch-name-input"), "OAuth Redirect");
    expect(screen.getByTestId("branch-preview")).toHaveTextContent("fix/oauth-redirect");
    await userEvent.click(screen.getByTestId("branch-create"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ branch: "fix/oauth-redirect", aiLater: undefined })
    );
  });

  it("'Let AI name it later' submits with aiLater and no branch", async () => {
    setBackends();
    const { onSubmit } = setup();
    await userEvent.click(screen.getByTestId("branch-ai-later"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ aiLater: true, branch: undefined })
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- src/components/primarysidebar/NewWorkspaceDialog.test.tsx`
Expected: FAIL — `Cannot find module './NewWorkspaceDialog'`.

- [ ] **Step 3: Write the minimal implementation**

```tsx
// src/components/primarysidebar/NewWorkspaceDialog.tsx
// Opened by the Projects "+" action: choose a coding agent, a base branch, and a
// branch name (type prefix + slug) for a new workspace's worktree in one flow.
// Defer naming to the AI with "Let AI name it later".
import { useState } from "react";
import { Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { composeTypedBranch } from "@/lib/branch-name";
import { cn } from "@/lib/utils";

const BRANCH_TYPES = ["feature", "fix", "bug", "chore", "hotfix"] as const;
type BranchType = (typeof BRANCH_TYPES)[number];

export interface NewWorkspacePayload {
  backend: string;
  baseBranch?: string;
  branch?: string;
  aiLater?: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  projectPath: string | null;
  onSubmit: (payload: NewWorkspacePayload) => void;
}

export function NewWorkspaceDialog({
  open,
  onOpenChange,
  projectName,
  projectPath,
  onSubmit,
}: Props) {
  const [type, setType] = useState<BranchType>("feature");
  const [name, setName] = useState("");

  const composed = composeTypedBranch(type, name);
  const canCreate = composed !== "";

  function reset() {
    setType("feature");
    setName("");
  }

  function backendId() {
    return "claude-code";
  }

  function baseBranch(): string | undefined {
    return undefined;
  }

  function create() {
    if (!canCreate) return;
    onOpenChange(false);
    onSubmit({ backend: backendId(), baseBranch: baseBranch(), branch: composed });
    reset();
  }

  function aiLater() {
    onOpenChange(false);
    onSubmit({ backend: backendId(), baseBranch: baseBranch(), aiLater: true });
    reset();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="new-workspace-dialog">
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
          <DialogDescription>
            Set up an isolated worktree for {projectName}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Branch type</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Branch type">
              {BRANCH_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  aria-pressed={type === t}
                  data-testid={`branch-type-${t}`}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] font-mono transition-colors duration-100",
                    type === t
                      ? "bg-accent text-accent-foreground"
                      : "bg-sidebar-hover text-foreground hover:bg-muted"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Branch name</span>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") create();
              }}
              placeholder="short description (e.g. login-page)"
              data-testid="branch-name-input"
              className="font-mono text-[12px]"
            />
            <span className="font-mono text-[11px] text-muted-foreground" data-testid="branch-preview">
              {composed || "feature/…"}
            </span>
          </div>

          <div className="mt-1 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={aiLater}
              data-testid="branch-ai-later"
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] text-accent transition-colors duration-100 hover:bg-sidebar-hover"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Let AI name it later
            </button>
            <button
              type="button"
              onClick={create}
              disabled={!canCreate}
              data-testid="branch-create"
              className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-foreground transition-colors duration-100 hover:bg-accent/90 disabled:opacity-50"
            >
              Create workspace
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

> Note: `projectPath` and `baseBranch()`/`backendId()` are placeholders filled in Tasks 2-3. The `eslint` "unused var" rule may flag `projectPath` — it gets used in Task 3. If the build fails on it before then, prefix with `void projectPath;` inside the component body temporarily; Task 3 removes that.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test -- src/components/primarysidebar/NewWorkspaceDialog.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/primarysidebar/NewWorkspaceDialog.tsx src/components/primarysidebar/NewWorkspaceDialog.test.tsx
git commit -m "feat(workspace): scaffold unified NewWorkspaceDialog with branch naming"
```

---

## Task 2: Add the coding-agent Select

Source agents from `useWorkbench.backends`, default to the active one, show brand icons, and include the chosen id in the payload.

**Files:**
- Modify: `src/components/primarysidebar/NewWorkspaceDialog.tsx`
- Test: `src/components/primarysidebar/NewWorkspaceDialog.test.tsx`

- [ ] **Step 1: Write the failing test (append to the existing describe block file)**

```tsx
// add to NewWorkspaceDialog.test.tsx
import { brandFor } from "@/lib/backend-brand"; // add to imports at top

describe("NewWorkspaceDialog — agent select", () => {
  it("defaults to the active backend and submits its id", async () => {
    useWorkbench.setState({
      ...initial,
      backends: [
        makeBackend({ id: "codex", name: "Codex", active: false }),
        makeBackend({ id: "claude-code", name: "Claude Code", active: true }),
      ],
    });
    const onSubmit = vi.fn();
    renderWithProviders(
      <NewWorkspaceDialog open onOpenChange={vi.fn()} projectName="demo" projectPath={null} onSubmit={onSubmit} />
    );
    await userEvent.click(screen.getByTestId("branch-ai-later"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ backend: "claude-code" }));
  });

  it("changing the agent select changes the submitted backend", async () => {
    useWorkbench.setState({
      ...initial,
      backends: [
        makeBackend({ id: "claude-code", name: "Claude Code", active: true }),
        makeBackend({ id: "codex", name: "Codex", active: false }),
      ],
    });
    const onSubmit = vi.fn();
    renderWithProviders(
      <NewWorkspaceDialog open onOpenChange={vi.fn()} projectName="demo" projectPath={null} onSubmit={onSubmit} />
    );
    await userEvent.click(screen.getByTestId("agent-select"));
    await userEvent.click(await screen.findByRole("option", { name: /Codex/ }));
    await userEvent.click(screen.getByTestId("branch-ai-later"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ backend: "codex" }));
  });

  it("falls back to claude-code when no agents are installed", async () => {
    useWorkbench.setState({ ...initial, backends: [] });
    const onSubmit = vi.fn();
    renderWithProviders(
      <NewWorkspaceDialog open onOpenChange={vi.fn()} projectName="demo" projectPath={null} onSubmit={onSubmit} />
    );
    expect(screen.getByTestId("agent-select")).toBeDisabled();
    await userEvent.click(screen.getByTestId("branch-ai-later"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ backend: "claude-code" }));
    expect(brandFor("claude-code")?.label).toBe("Claude Code");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- src/components/primarysidebar/NewWorkspaceDialog.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="agent-select"]`.

- [ ] **Step 3: Implement the agent Select**

Add imports at the top of `NewWorkspaceDialog.tsx`:

```tsx
import { useWorkbench } from "@/state/store";
import { brandFor } from "@/lib/backend-brand";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
```

Inside the component, replace the placeholder `backendId()` with real state (place after the `name` state):

```tsx
  const backends = useWorkbench((s) => s.backends);
  const [backend, setBackend] = useState(
    () => backends.find((b) => b.active)?.id ?? backends[0]?.id ?? "claude-code"
  );
  const selectedBrand = brandFor(backend);
```

Delete the placeholder `function backendId()` and update both call sites to pass `backend`:

```tsx
    onSubmit({ backend, baseBranch: baseBranch(), branch: composed });
    // ...
    onSubmit({ backend, baseBranch: baseBranch(), aiLater: true });
```

Add the agent field as the FIRST field inside the `flex flex-col gap-3` container (above Branch type):

```tsx
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Coding agent</span>
            <Select value={backend} onValueChange={setBackend} disabled={backends.length === 0}>
              <SelectTrigger className="h-8 text-[12px]" data-testid="agent-select">
                {selectedBrand?.Icon ? <selectedBrand.Icon size={14} /> : null}
                <SelectValue placeholder={selectedBrand?.label ?? backend} />
              </SelectTrigger>
              <SelectContent>
                {backends.map((b) => {
                  const brand = brandFor(b.id);
                  const Icon = brand?.Icon;
                  return (
                    <SelectItem key={b.id} value={b.id} className="text-[12px]">
                      <span className="flex items-center gap-2">
                        {Icon ? <Icon size={14} /> : null}
                        {brand?.label ?? b.name}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test -- src/components/primarysidebar/NewWorkspaceDialog.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/primarysidebar/NewWorkspaceDialog.tsx src/components/primarysidebar/NewWorkspaceDialog.test.tsx
git commit -m "feat(workspace): add coding-agent select to NewWorkspaceDialog"
```

---

## Task 3: Add the base-branch Select

Load branches via `gitBranchList(projectPath)` when the dialog opens, default to the current branch, and include the choice in the payload.

**Files:**
- Modify: `src/components/primarysidebar/NewWorkspaceDialog.tsx`
- Test: `src/components/primarysidebar/NewWorkspaceDialog.test.tsx`

- [ ] **Step 1: Write the failing test (append to the file)**

```tsx
// add to NewWorkspaceDialog.test.tsx
import { invoke } from "@tauri-apps/api/core"; // add to imports at top

describe("NewWorkspaceDialog — base branch select", () => {
  it("loads branches, defaults to the current branch, and submits it", async () => {
    useWorkbench.setState({
      ...initial,
      backends: [makeBackend({ id: "claude-code", name: "Claude Code", active: true })],
    });
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "git_branch_list") {
        return [
          { name: "main", isRemote: false, isCurrent: false },
          { name: "develop", isRemote: false, isCurrent: true },
        ] as never;
      }
      return undefined as never;
    });
    const onSubmit = vi.fn();
    renderWithProviders(
      <NewWorkspaceDialog open onOpenChange={vi.fn()} projectName="demo" projectPath="/tmp/demo" onSubmit={onSubmit} />
    );
    // default = current branch "develop"
    await screen.findByText("develop");
    await userEvent.click(screen.getByTestId("branch-ai-later"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ baseBranch: "develop" }));
  });

  it("leaves baseBranch undefined when projectPath is null", async () => {
    useWorkbench.setState({
      ...initial,
      backends: [makeBackend({ id: "claude-code", name: "Claude Code", active: true })],
    });
    const onSubmit = vi.fn();
    renderWithProviders(
      <NewWorkspaceDialog open onOpenChange={vi.fn()} projectName="demo" projectPath={null} onSubmit={onSubmit} />
    );
    await userEvent.click(screen.getByTestId("branch-ai-later"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ baseBranch: undefined }));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- src/components/primarysidebar/NewWorkspaceDialog.test.tsx`
Expected: FAIL — submitted `baseBranch` is `undefined`, not `"develop"`.

- [ ] **Step 3: Implement the base-branch Select**

Add imports at the top:

```tsx
import { useEffect } from "react"; // merge with existing useState import: useState, useEffect
import { gitBranchList } from "@/lib/tauri";
import type { Branch } from "@/lib/ipc";
```

Add state + load effect after the `backend` state:

```tsx
  const [branches, setBranches] = useState<Branch[]>([]);
  const [base, setBase] = useState<string>("");

  useEffect(() => {
    if (!open || !projectPath) {
      setBranches([]);
      setBase("");
      return;
    }
    let cancelled = false;
    gitBranchList(projectPath)
      .then((list) => {
        if (cancelled) return;
        setBranches(list);
        setBase(list.find((b) => b.isCurrent)?.name ?? "");
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectPath]);
```

Replace the placeholder `function baseBranch()` body and both call sites — change `baseBranch()` to `base || undefined`:

```tsx
    onSubmit({ backend, baseBranch: base || undefined, branch: composed });
    // ...
    onSubmit({ backend, baseBranch: base || undefined, aiLater: true });
```

Delete the now-unused `function baseBranch()` and any temporary `void projectPath;`.

Add the base-branch field directly below the agent field:

```tsx
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Base branch</span>
            <Select value={base} onValueChange={setBase} disabled={branches.length === 0}>
              <SelectTrigger className="h-8 text-[12px]" data-testid="base-branch-select">
                <SelectValue placeholder={projectPath ? "Default branch" : "—"} />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={`${b.isRemote ? "r" : "l"}-${b.name}`} value={b.name} className="text-[12px]">
                    <span className="flex items-center gap-2">
                      {b.name}
                      {b.isCurrent ? (
                        <span className="text-[10px] text-muted-foreground">current</span>
                      ) : null}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test -- src/components/primarysidebar/NewWorkspaceDialog.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/primarysidebar/NewWorkspaceDialog.tsx src/components/primarysidebar/NewWorkspaceDialog.test.tsx
git commit -m "feat(workspace): add base-branch select to NewWorkspaceDialog"
```

---

## Task 4: Wire NewWorkspaceDialog into ProjectsView

Replace the two old dialogs with the new one and forward the user-selected backend into `create()` and `resolveStartupLaunch()`.

**Files:**
- Modify: `src/components/primarysidebar/ProjectsView.tsx`
- Test: `src/components/primarysidebar/ProjectsView.test.tsx`

- [ ] **Step 1: Update the ProjectsView tests to the merged flow**

Replace the three flow tests ("AI name later", "typed name", "Create from") in `ProjectsView.test.tsx` with these. Keep all other tests as-is.

```tsx
  it("New workspace → 'AI name later' creates with an undefined branch (sidecar callsign)", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", name: "demo", path: "/tmp/demo" })],
      backends: [makeBackend({ id: "claude-code", name: "Claude Code", active: true })],
    });
    vi.mocked(invoke).mockResolvedValueOnce({ id: "w-new", projectId: "p1", branch: "viper", agentBackend: "claude-code", worktreePath: "", status: "active", sessionId: "s", title: "Viper" } as never);
    renderWithProviders(<ProjectsView />);
    await userEvent.click(screen.getByLabelText("New workspace"));
    await userEvent.click(await screen.findByTestId("branch-ai-later"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("workspace_create", {
      projectId: "p1",
      projectPath: "/tmp/demo",
      branch: undefined,
      backend: "claude-code",
      baseBranch: undefined,
    }));
    expect(useWorkbench.getState().pendingSetupIds).toContain("w-new");
    await waitFor(() => expect(useWorkbench.getState().pendingAiRename).toContain("w-new"));
  });

  it("New workspace → typed name creates the composed feature/<slug> branch", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", name: "demo", path: "/tmp/demo" })],
      backends: [makeBackend({ id: "claude-code", name: "Claude Code", active: true })],
    });
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "git_branch_list") return [] as never;
      if (cmd === "workspace_create") {
        return { id: "w-named", projectId: "p1", branch: "feature/login-page", agentBackend: "claude-code", worktreePath: "", status: "active", sessionId: "s" } as never;
      }
      return undefined as never;
    });
    renderWithProviders(<ProjectsView />);
    await userEvent.click(screen.getByLabelText("New workspace"));
    await userEvent.type(await screen.findByTestId("branch-name-input"), "Login Page");
    await userEvent.click(screen.getByTestId("branch-create"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("workspace_create", {
      projectId: "p1",
      projectPath: "/tmp/demo",
      branch: "feature/login-page",
      backend: "claude-code",
      baseBranch: undefined,
    }));
  });

  it("New workspace → picking a non-default agent creates with that backend", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", name: "demo", path: "/tmp/demo" })],
      backends: [
        makeBackend({ id: "claude-code", name: "Claude Code", active: true }),
        makeBackend({ id: "codex", name: "Codex", active: false }),
      ],
    });
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "git_branch_list") return [] as never;
      if (cmd === "workspace_create") {
        return { id: "w-cx", projectId: "p1", branch: "x", agentBackend: "codex", worktreePath: "", status: "active", sessionId: "s" } as never;
      }
      return undefined as never;
    });
    renderWithProviders(<ProjectsView />);
    await userEvent.click(screen.getByLabelText("New workspace"));
    await userEvent.click(await screen.findByTestId("agent-select"));
    await userEvent.click(await screen.findByRole("option", { name: /Codex/ }));
    await userEvent.click(screen.getByTestId("branch-ai-later"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("workspace_create", {
      projectId: "p1",
      projectPath: "/tmp/demo",
      branch: undefined,
      backend: "codex",
      baseBranch: undefined,
    }));
  });
```

Also update the "logs an error when workspace creation fails" test's backend fixture id to `"claude-code"` and add a `git_branch_list` branch to its mock so opening the dialog doesn't throw:

```tsx
  it("logs an error when workspace creation fails", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", name: "demo" })],
      backends: [makeBackend({ id: "claude-code", name: "Claude Code", active: true })],
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "git_branch_list") return [] as never;
      throw new Error("fail");
    });
    renderWithProviders(<ProjectsView />);
    await userEvent.click(screen.getByLabelText("New workspace"));
    await userEvent.click(await screen.findByTestId("branch-ai-later"));
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    errSpy.mockRestore();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test -- src/components/primarysidebar/ProjectsView.test.tsx`
Expected: FAIL — "Create from" label gone / `agent-select` not found / old `NameWorkspaceDialog` still wired.

- [ ] **Step 3: Rewrite ProjectsView wiring**

Replace the imports and the dialog/handler sections of `ProjectsView.tsx`. Final relevant content:

```tsx
import { useState } from "react";
import { FolderPlus } from "lucide-react";
import { useWorkbench } from "@/state/store";
import { useWorkspace } from "@/hooks/useWorkspace";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProjectItem } from "./ProjectItem";
import { NewWorkspaceDialog, type NewWorkspacePayload } from "./NewWorkspaceDialog";
import { pickProjectFolder } from "@/lib/dialog";
import { resolveStartupLaunch } from "@/lib/launch";

const DEFAULT_BACKEND = "claude-code";
```

Update `onAddWorkspace` to take the payload and use its backend:

```tsx
  async function onAddWorkspace(projectId: string, opts: NewWorkspacePayload) {
    try {
      const backend = opts.backend || DEFAULT_BACKEND;
      const ws = await create(projectId, opts.branch, backend, opts.baseBranch);
      const { command, args } = resolveStartupLaunch(backend);
      useWorkbench.getState().setLaunchSpec(ws.id, { command, args });
      if (opts.aiLater) useWorkbench.getState().markPendingAiRename(ws.id);
    } catch (e) {
      console.error("addWorkspace failed", e);
    }
  }
```

Replace the `createFromProjectId` state + `createFromProject` lookup with a single state, and the two `<...Dialog>` blocks with one:

```tsx
  const [newWorkspaceProjectId, setNewWorkspaceProjectId] = useState<string | null>(null);
  // ...
  const newWorkspaceProject = projects.find((p) => p.id === newWorkspaceProjectId) ?? null;
```

In the `ProjectItem` mapping, drop the `onCreateFrom` prop and keep `onAddWorkspace`:

```tsx
              <ProjectItem
                key={p.id}
                project={p}
                onAddWorkspace={(projectId) => setNewWorkspaceProjectId(projectId)}
                onSettings={(projectId) => openProjectSettings({ projectId })}
              />
```

Replace both dialogs at the bottom with:

```tsx
      <NewWorkspaceDialog
        open={newWorkspaceProjectId !== null}
        onOpenChange={(open) => {
          if (!open) setNewWorkspaceProjectId(null);
        }}
        projectName={newWorkspaceProject?.name ?? ""}
        projectPath={newWorkspaceProject?.path ?? null}
        onSubmit={(payload) => {
          if (newWorkspaceProjectId) void onAddWorkspace(newWorkspaceProjectId, payload);
        }}
      />
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test -- src/components/primarysidebar/ProjectsView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/primarysidebar/ProjectsView.tsx src/components/primarysidebar/ProjectsView.test.tsx
git commit -m "feat(workspace): wire NewWorkspaceDialog into ProjectsView with agent select"
```

---

## Task 5: Remove the "Create from" action from ProjectItem

The base branch now lives inside the dialog, so the project-row "Create from" button is dead.

**Files:**
- Modify: `src/components/primarysidebar/ProjectItem.tsx`
- Test: `src/components/primarysidebar/ProjectItem.test.tsx`

- [ ] **Step 1: Update the test — remove the "Create from" case**

Delete this test from `ProjectItem.test.tsx`:

```tsx
  it("calls onCreateFrom via the create-from button", async () => {
    const onCreateFrom = vi.fn();
    renderWithProviders(<ProjectItem project={makeProject({ id: "p1" })} onCreateFrom={onCreateFrom} />);
    await userEvent.click(screen.getByLabelText("Create from"));
    expect(onCreateFrom).toHaveBeenCalledWith("p1");
  });
```

Add a test asserting the button is gone:

```tsx
  it("does not render a 'Create from' action", () => {
    renderWithProviders(<ProjectItem project={makeProject({ id: "p1" })} />);
    expect(screen.queryByLabelText("Create from")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- src/components/primarysidebar/ProjectItem.test.tsx`
Expected: FAIL — "Create from" button still present.

- [ ] **Step 3: Remove the button and prop**

In `ProjectItem.tsx`:
- Remove `Link2` from the `lucide-react` import (keep `ChevronRight`, `Settings2`, `Plus`).
- Remove `onCreateFrom?: (projectId: string) => void;` from `Props`.
- Remove `onCreateFrom` from the destructured params.
- Delete the `ActionButton` block with `icon={Link2}` / `label="Create from"` / `testId={`project-${project.id}-createfrom`}`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test -- src/components/primarysidebar/ProjectItem.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/primarysidebar/ProjectItem.tsx src/components/primarysidebar/ProjectItem.test.tsx
git commit -m "refactor(workspace): drop project-row 'Create from' action"
```

---

## Task 6: Delete the obsolete dialogs

Remove `NameWorkspaceDialog` and `CreateFromDialog` now that nothing references them.

**Files:**
- Delete: `src/components/primarysidebar/NameWorkspaceDialog.tsx`, `NameWorkspaceDialog.test.tsx`, `CreateFromDialog.tsx`

- [ ] **Step 1: Confirm there are no remaining references**

Run: `grep -rn "NameWorkspaceDialog\|CreateFromDialog" src`
Expected: no matches (only the files about to be deleted, if any).

- [ ] **Step 2: Delete the files**

```bash
git rm src/components/primarysidebar/NameWorkspaceDialog.tsx \
       src/components/primarysidebar/NameWorkspaceDialog.test.tsx \
       src/components/primarysidebar/CreateFromDialog.tsx
```

- [ ] **Step 3: Run the full suite + type check**

Run: `bun run test -- src/components/primarysidebar/`
Expected: PASS (no missing-import errors).

Run: `bun run build`
Expected: succeeds (no unused-import or type errors).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(workspace): remove obsolete NameWorkspaceDialog and CreateFromDialog"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run coverage across the suite**

Run: `bun run test:coverage`
Expected: PASS with coverage thresholds met (lines 100 / branches 95 / functions 100 / statements 100). If a branch in `NewWorkspaceDialog.tsx` is uncovered (e.g. `selectedBrand?.Icon` falsy path, or `branches.length === 0` disabled path), add a focused test for it.

- [ ] **Step 2: Build**

Run: `bun run build`
Expected: succeeds.

- [ ] **Step 3: Manual smoke test**

Run: `bun run tauri dev`. Add/open a project, click the **+** (New workspace). Verify:
- The agent dropdown lists installed agents with brand icons and defaults to your configured default.
- The base-branch dropdown lists branches and defaults to the current branch.
- Typing a name shows the `feature/<slug>` preview; "Create workspace" creates the worktree with the chosen agent + base branch.
- "Let AI name it later" creates immediately.
- There is no longer a separate "Create from" button on the project row.

- [ ] **Step 4: Final commit (if any cleanup was needed)**

```bash
git add -A
git commit -m "test(workspace): cover NewWorkspaceDialog edge cases"
```

---

## Self-review notes

- **Spec coverage:** agent select (Task 2), base branch defaulting to current (Task 3), branch-type chips + name + AI-later (Task 1), single `+` entry point (Task 5), backend now dynamic (Task 4), deletion of old dialogs (Task 6), no-installed-agents fallback (Task 2). All spec sections map to a task.
- **Type consistency:** `NewWorkspacePayload { backend; baseBranch?; branch?; aiLater? }` defined in Task 1, consumed unchanged in Task 4. `onSubmit` is the single callback throughout (no `onCreate`/`onAiLater` split). `gitBranchList` → `Branch[]` with `isCurrent`/`isRemote`/`name` matches `@/lib/ipc`.
- **Testids introduced:** `new-workspace-dialog`, `agent-select`, `base-branch-select`; reused `branch-type-*`, `branch-name-input`, `branch-preview`, `branch-create`, `branch-ai-later`.
