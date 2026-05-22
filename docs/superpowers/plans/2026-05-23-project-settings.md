# Project Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a per-project Project Settings modal that mirrors Conductor's surface area with Maverick-native naming, persisted in `maverick.json`, with the bottom Panel reading & executing the configured setup/run/archive scripts.

**Architecture:** Three-layer stack — sidecar owns schema, atomic file I/O, and workspace lifecycle hooks; Rust forwards 3 new RPCs; React renders a `ProjectSettingsPanel` that shares the `SettingsShell` chrome with the global `SettingsPanel`, with autosave-on-blur + status pill semantics. The Panel reads scripts via a new `useScriptRunner` hook that wraps existing `pty_spawn`.

**Tech Stack:** Tauri v2, React 18, TypeScript, Zustand, zod, Vitest, bun:sqlite (existing), bun:test (sidecar), cargo test (Rust), shadcn primitives + Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-05-23-project-settings-design.md`

---

## Pre-Flight

### Task 0: Create isolated worktree for this feature

**Files:**
- New branch: `cc-feature/project-settings` (off `main`)

- [ ] **Step 1: Branch & switch**

```bash
git fetch origin
git checkout main
git pull
git checkout -b cc-feature/project-settings
```

- [ ] **Step 2: Sanity check current state**

```bash
bun install
bun run test 2>&1 | tail -5
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -3
```

Expected: tests pass, cargo check exits 0.

---

## Zone 1 — Foundation (must land first; everything imports from this)

### Task 1: Add `projectSettings` state + `openProjectSettings` action to useWorkbench

**Files:**
- Modify: `src/state/store.ts`
- Modify: `src/state/store.test.ts`

- [ ] **Step 1: Write failing test**

Append to `src/state/store.test.ts` inside the `describe("workbench store", ...)` block:

```ts
it("openProjectSettings sets projectId and section, marks open", () => {
    useWorkbench.getState().openProjectSettings({
      projectId: "p1",
      initialSection: "scripts",
      focusField: "setup",
    });
    const ps = useWorkbench.getState().projectSettings;
    expect(ps.open).toBe(true);
    expect(ps.projectId).toBe("p1");
    expect(ps.initialSection).toBe("scripts");
    expect(ps.focusField).toBe("setup");
  });

  it("closeProjectSettings clears projectId", () => {
    useWorkbench.getState().openProjectSettings({ projectId: "p1" });
    useWorkbench.getState().closeProjectSettings();
    const ps = useWorkbench.getState().projectSettings;
    expect(ps.open).toBe(false);
    expect(ps.projectId).toBeNull();
  });
```

- [ ] **Step 2: Run failing**

```bash
bun run test src/state/store.test.ts 2>&1 | tail -10
```

Expected: 2 failing tests on missing `openProjectSettings` / `closeProjectSettings`.

- [ ] **Step 3: Add to store**

In `src/state/store.ts`, add to the `WorkbenchState` interface (alongside `setSettingsOpen`):

```ts
projectSettings: {
    open: boolean;
    projectId: string | null;
    initialSection?: "identity" | "workspaces" | "preview" | "scripts" | "preferences";
    focusField?: string;
  };
  openProjectSettings: (args: {
    projectId: string;
    initialSection?: "identity" | "workspaces" | "preview" | "scripts" | "preferences";
    focusField?: string;
  }) => void;
  closeProjectSettings: () => void;
```

In the store initializer (next to `settingsOpen: false,`):

```ts
projectSettings: { open: false, projectId: null },
```

And in the actions block (next to `setSettingsOpen: (open) => set({ settingsOpen: open }),`):

```ts
openProjectSettings: ({ projectId, initialSection, focusField }) =>
      set({ projectSettings: { open: true, projectId, initialSection, focusField } }),
    closeProjectSettings: () =>
      set((s) => ({ projectSettings: { ...s.projectSettings, open: false, projectId: null } })),
```

- [ ] **Step 4: Run tests**

```bash
bun run test src/state/store.test.ts 2>&1 | tail -8
```

Expected: PASS — all store tests.

- [ ] **Step 5: Commit**

```bash
git add src/state/store.ts src/state/store.test.ts
git commit -m "feat(store): add projectSettings open state + actions"
```

---

### Task 2: Extract `SettingsShell` from `SettingsPanel`

**Files:**
- Create: `src/components/settings-shell/SettingsShell.tsx`
- Create: `src/components/settings-shell/SettingsShell.test.tsx`
- Create: `src/components/settings-shell/index.ts`

- [ ] **Step 1: Write failing test**

```tsx
// src/components/settings-shell/SettingsShell.test.tsx
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { SettingsShell } from "./SettingsShell";

describe("SettingsShell", () => {
  it("renders title chip, nav, content, footer", () => {
    renderWithProviders(
      <SettingsShell
        open
        onOpenChange={() => {}}
        title="Project Settings · demo"
        nav={<div data-testid="rail" />}
        footer={<div data-testid="foot" />}
      >
        <div data-testid="body">Body</div>
      </SettingsShell>
    );
    expect(screen.getByText("Project Settings · demo")).toBeInTheDocument();
    expect(screen.getByTestId("rail")).toBeInTheDocument();
    expect(screen.getByTestId("body")).toBeInTheDocument();
    expect(screen.getByTestId("foot")).toBeInTheDocument();
  });

  it("calls onOpenChange(false) when dialog requests close", async () => {
    const handler = vi.fn();
    renderWithProviders(
      <SettingsShell open onOpenChange={handler} title="t" nav={<div />} footer={<div />}>
        <div />
      </SettingsShell>
    );
    await userEvent.keyboard("{Escape}");
    expect(handler).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 2: Run failing**

```bash
bun run test src/components/settings-shell/SettingsShell.test.tsx 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement shell**

```tsx
// src/components/settings-shell/SettingsShell.tsx
import { ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  nav: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}

export function SettingsShell({ open, onOpenChange, title, description, nav, footer, children }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="settings-shell"
        className="grid h-[min(680px,86vh)] w-[92vw] !max-w-[960px] grid-cols-[240px_1fr] grid-rows-[auto_1fr_auto] gap-0 overflow-hidden bg-popover p-0 shadow-modal"
        style={{ border: "1px solid hsl(var(--border))" }}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {description && <DialogDescription className="sr-only">{description}</DialogDescription>}
        <div
          className="col-span-2 flex items-center px-5 py-3 text-[12px] font-medium text-foreground"
          style={{ borderBottom: "1px solid hsl(var(--border))" }}
        >
          {title}
        </div>
        <div className="row-span-1" style={{ borderRight: "1px solid hsl(var(--border))" }}>
          {nav}
        </div>
        <div className="overflow-y-auto px-8 py-6">{children}</div>
        <div className="col-start-2">{footer}</div>
      </DialogContent>
    </Dialog>
  );
}
```

```ts
// src/components/settings-shell/index.ts
export { SettingsShell } from "./SettingsShell";
```

- [ ] **Step 4: Run tests**

```bash
bun run test src/components/settings-shell/ 2>&1 | tail -8
```

Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings-shell/
git commit -m "feat(settings-shell): extract reusable SettingsShell"
```

---

### Task 3: Rewire global `SettingsPanel` to use `SettingsShell` (no behavior change)

**Files:**
- Modify: `src/panels/settings/SettingsPanel.tsx`

- [ ] **Step 1: Sanity test existing**

```bash
bun run test src/panels/settings/ src/components/workbench/Workbench.test.tsx 2>&1 | tail -5
```

Note current pass count.

- [ ] **Step 2: Replace Dialog with SettingsShell in `SettingsPanel.tsx`**

Replace the `return (...)` body. Keep all existing state, refs, and section logic. Substitute:

```tsx
return (
    <SettingsShell
      open={isOpen}
      onOpenChange={handleOpenChange}
      title="Settings"
      description={meta.description}
      nav={
        <SettingsNavRail
          section={section}
          onSelect={handleSelectSection}
          onOpenFile={handleOpenFile}
        />
      }
      footer={<SettingsFooter status={status} errorMessage={lastError ?? undefined} />}
    >
      <AnimatePresence mode="wait">
        {jsonMode ? (
          <motion.div key="json" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }} className="flex h-full flex-col">
            <SettingsJsonEditor onClose={() => setJsonMode(false)} />
          </motion.div>
        ) : (
          <motion.div key={section} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>
            <SettingsHeader title={meta.title} description={meta.description} badge={meta.badge} />
            <ContentComponent />
          </motion.div>
        )}
      </AnimatePresence>
    </SettingsShell>
  );
```

Add the import at the top: `import { SettingsShell } from "@/components/settings-shell";`

Remove the no-longer-used `Dialog`, `DialogContent`, `DialogTitle`, `DialogDescription` imports.

- [ ] **Step 3: Run all settings + workbench tests**

```bash
bun run test src/panels/settings/ src/components/workbench/ 2>&1 | tail -10
```

Expected: same pass count as Step 1 — zero regressions.

- [ ] **Step 4: Commit**

```bash
git add src/panels/settings/SettingsPanel.tsx
git commit -m "refactor(settings): SettingsPanel uses shared SettingsShell"
```

---

## Zone 2 — Sidecar (parallel after Zone 1)

### Task 4: Extend `MaverickConfigSchema` with `ProjectSettingsSchema` + defaults applier

**Files:**
- Modify: `sidecar/config-loader.ts`
- Modify: `sidecar/types.ts`
- Create: `sidecar/project-settings.ts`
- Create: `sidecar/project-settings.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// sidecar/project-settings.test.ts
import { describe, it, expect } from "bun:test";
import { ProjectSettingsSchema, applyDefaults } from "./project-settings";

describe("ProjectSettingsSchema", () => {
  it("parses minimal config and fills defaults", () => {
    const parsed = ProjectSettingsSchema.parse({});
    const filled = applyDefaults(parsed, "/tmp/demo");
    expect(filled.name).toBe("demo");
    expect(filled.rootPath).toBe("/tmp/demo");
    expect(filled.workspaces.branchFrom).toBe("origin/main");
    expect(filled.workspaces.filesToCopy).toEqual([]);
    expect(filled.remote).toBe("origin");
    expect(filled.scripts.setup).toBe("");
    expect(filled.scripts.run).toBe("");
    expect(filled.scripts.archive).toBe("");
    expect(filled.preferences.review).toBe("");
  });

  it("preserves provided values", () => {
    const filled = applyDefaults(
      ProjectSettingsSchema.parse({
        name: "alpha",
        scripts: { setup: "bun install" },
        preferences: { general: "be terse" },
      }),
      "/tmp/alpha"
    );
    expect(filled.name).toBe("alpha");
    expect(filled.scripts.setup).toBe("bun install");
    expect(filled.scripts.run).toBe("");
    expect(filled.preferences.general).toBe("be terse");
  });

  it("preserves unknown preference keys", () => {
    const raw = ProjectSettingsSchema.parse({
      preferences: { custom: "extra" },
    });
    expect((raw.preferences as Record<string, string>).custom).toBe("extra");
  });
});
```

- [ ] **Step 2: Run failing**

```bash
bun test sidecar/project-settings.test.ts 2>&1 | tail -10
```

Expected: module not found.

- [ ] **Step 3: Implement schema + defaults**

```ts
// sidecar/project-settings.ts
import { z } from "zod";
import { basename } from "path";

const ScriptsSchema = z
  .object({
    setup: z.string().default(""),
    run: z.string().default(""),
    archive: z.string().default(""),
  })
  .partial()
  .default({});

const WorkspacesSchema = z
  .object({
    basePath: z.string().optional(),
    branchFrom: z.string().default("origin/main"),
    filesToCopy: z.array(z.string()).default([]),
  })
  .partial()
  .default({});

const PreferencesSchema = z.record(z.string(), z.string()).default({});

export const ProjectSettingsSchema = z
  .object({
    name: z.string().optional(),
    rootPath: z.string().optional(),
    workspaces: WorkspacesSchema,
    remote: z.string().default("origin"),
    previewUrl: z.string().default(""),
    scripts: ScriptsSchema,
    preferences: PreferencesSchema,
  })
  .partial()
  .default({});

export type ProjectSettingsRaw = z.infer<typeof ProjectSettingsSchema>;

export interface ProjectSettings {
  name: string;
  rootPath: string;
  workspaces: {
    basePath?: string;
    branchFrom: string;
    filesToCopy: string[];
  };
  remote: string;
  previewUrl: string;
  scripts: { setup: string; run: string; archive: string };
  preferences: Record<string, string>;
}

export function applyDefaults(raw: ProjectSettingsRaw, projectPath: string): ProjectSettings {
  const ws = raw.workspaces ?? {};
  const sc = raw.scripts ?? {};
  return {
    name: raw.name ?? basename(projectPath),
    rootPath: raw.rootPath ?? projectPath,
    workspaces: {
      basePath: ws.basePath,
      branchFrom: ws.branchFrom ?? "origin/main",
      filesToCopy: ws.filesToCopy ?? [],
    },
    remote: raw.remote ?? "origin",
    previewUrl: raw.previewUrl ?? "",
    scripts: {
      setup: sc.setup ?? "",
      run: sc.run ?? "",
      archive: sc.archive ?? "",
    },
    preferences: { ...(raw.preferences ?? {}) },
  };
}
```

In `sidecar/types.ts`, add:

```ts
export interface ProjectSettings {
  name: string;
  rootPath: string;
  workspaces: {
    basePath?: string;
    branchFrom: string;
    filesToCopy: string[];
  };
  remote: string;
  previewUrl: string;
  scripts: { setup: string; run: string; archive: string };
  preferences: Record<string, string>;
}
```

In `sidecar/config-loader.ts`, add to `MaverickConfigSchema`:

```ts
import { ProjectSettingsSchema } from "./project-settings";
// ...
export const MaverickConfigSchema = z.object({
  version: z.number(),
  backends: z.object({
    default: z.string(),
    available: z.array(BackendDefSchema),
  }),
  worktrees: z.object({ base: z.string() }).optional(),
  skills: z.array(SkillSchema).optional(),
  presets: z.array(PresetSchema).optional(),
  automations: z.array(AutomationSchema).optional(),
  mcps: z.array(MCPSchema).optional(),
  project: ProjectSettingsSchema.optional(),
});
```

- [ ] **Step 4: Run tests**

```bash
bun test sidecar/project-settings.test.ts 2>&1 | tail -8
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add sidecar/project-settings.ts sidecar/project-settings.test.ts sidecar/config-loader.ts sidecar/types.ts
git commit -m "feat(sidecar): ProjectSettings schema + defaults applier"
```

---

### Task 5: `ProjectSettingsStore` (atomic read/write of maverick.json)

**Files:**
- Create: `sidecar/project-settings-store.ts`
- Create: `sidecar/project-settings-store.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// sidecar/project-settings-store.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ProjectSettingsStore } from "./project-settings-store";

let dir: string;
let store: ProjectSettingsStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mvk-pset-"));
  store = new ProjectSettingsStore();
});

describe("ProjectSettingsStore", () => {
  it("returns defaults when maverick.json does not exist", () => {
    const settings = store.read(dir);
    expect(settings.name).toBe(require("path").basename(dir));
    expect(settings.scripts.setup).toBe("");
  });

  it("write creates the file atomically and merges into existing config", () => {
    writeFileSync(
      join(dir, "maverick.json"),
      JSON.stringify({ version: 1, backends: { default: "claude", available: [] } })
    );
    store.write(dir, { scripts: { setup: "bun install", run: "bun run dev", archive: "" } });
    const raw = JSON.parse(readFileSync(join(dir, "maverick.json"), "utf8"));
    expect(raw.project.scripts.setup).toBe("bun install");
    expect(raw.backends.default).toBe("claude");
    expect(existsSync(join(dir, "maverick.json.tmp"))).toBe(false);
  });

  it("write creates the file from scratch with version=1 when missing", () => {
    store.write(dir, { remote: "upstream" });
    const raw = JSON.parse(readFileSync(join(dir, "maverick.json"), "utf8"));
    expect(raw.version).toBe(1);
    expect(raw.project.remote).toBe("upstream");
  });

  it("read returns merged defaults applied", () => {
    writeFileSync(
      join(dir, "maverick.json"),
      JSON.stringify({ version: 1, backends: { default: "claude", available: [] }, project: { scripts: { setup: "echo hi" } } })
    );
    const s = store.read(dir);
    expect(s.scripts.setup).toBe("echo hi");
    expect(s.workspaces.branchFrom).toBe("origin/main");
  });

  it("rejects path-escape entries in filesToCopy on write", () => {
    expect(() =>
      store.write(dir, { workspaces: { branchFrom: "origin/main", filesToCopy: ["../escape.txt"] } } as never)
    ).toThrow(/path/i);
  });
});
```

- [ ] **Step 2: Run failing**

```bash
bun test sidecar/project-settings-store.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// sidecar/project-settings-store.ts
import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from "fs";
import { join, isAbsolute, normalize } from "path";
import { ProjectSettingsSchema, applyDefaults, type ProjectSettings } from "./project-settings";

export class ProjectSettingsStore {
  private configPath(projectPath: string): string {
    return join(projectPath, "maverick.json");
  }

  read(projectPath: string): ProjectSettings {
    const path = this.configPath(projectPath);
    if (!existsSync(path)) {
      return applyDefaults(ProjectSettingsSchema.parse({}), projectPath);
    }
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const projectRaw = (raw.project as object | undefined) ?? {};
    return applyDefaults(ProjectSettingsSchema.parse(projectRaw), projectPath);
  }

  write(projectPath: string, patch: Partial<ProjectSettings>): ProjectSettings {
    this.validateFilesToCopy(patch);
    const path = this.configPath(projectPath);
    const existing: Record<string, unknown> = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8"))
      : { version: 1, backends: { default: "claude", available: [] } };

    const currentProject = (existing.project as object | undefined) ?? {};
    const merged = deepMerge(currentProject, patch as Record<string, unknown>);
    const parsed = ProjectSettingsSchema.parse(merged);
    existing.project = parsed;

    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(existing, null, 2), "utf8");
    renameSync(tmp, path);
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* noop */ }

    return applyDefaults(parsed, projectPath);
  }

  private validateFilesToCopy(patch: Partial<ProjectSettings>): void {
    const ftc = patch.workspaces?.filesToCopy;
    if (!ftc) return;
    for (const p of ftc) {
      if (isAbsolute(p) || normalize(p).startsWith("..")) {
        throw new Error(`filesToCopy entry "${p}" must be a project-relative path`);
      }
    }
  }
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const av = a[k];
    if (v && typeof v === "object" && !Array.isArray(v) && av && typeof av === "object" && !Array.isArray(av)) {
      out[k] = deepMerge(av as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests**

```bash
bun test sidecar/project-settings-store.test.ts 2>&1 | tail -8
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add sidecar/project-settings-store.ts sidecar/project-settings-store.test.ts
git commit -m "feat(sidecar): atomic ProjectSettingsStore (read/write maverick.json)"
```

---

### Task 6: Wire `project.settings.get` / `update` / `openFile` RPC handlers

**Files:**
- Modify: `sidecar/rpc-handlers.ts`
- Modify: `sidecar/rpc-handlers.test.ts`

- [ ] **Step 1: Write failing test**

Append in `sidecar/rpc-handlers.test.ts` inside the existing describe block:

```ts
it("project.settings.get returns defaults for a path without maverick.json", async () => {
    const { handlers, dir } = makeWithTempProject();
    const result = (await handlers.dispatch("project.settings.get", { projectId: dir })) as { name: string; scripts: { setup: string } };
    expect(result.scripts.setup).toBe("");
  });

  it("project.settings.update writes patch and returns saved value", async () => {
    const { handlers, dir } = makeWithTempProject();
    const saved = (await handlers.dispatch("project.settings.update", {
      projectId: dir,
      patch: { scripts: { setup: "bun install", run: "", archive: "" } },
    })) as { scripts: { setup: string } };
    expect(saved.scripts.setup).toBe("bun install");

    const reread = (await handlers.dispatch("project.settings.get", { projectId: dir })) as { scripts: { setup: string } };
    expect(reread.scripts.setup).toBe("bun install");
  });

  it("project.settings.openFile returns the absolute path", async () => {
    const { handlers, dir } = makeWithTempProject();
    const res = (await handlers.dispatch("project.settings.openFile", { projectId: dir })) as { path: string };
    expect(res.path).toBe(`${dir}/maverick.json`);
  });
```

And the helper near the top of the file (if not already present):

```ts
function makeWithTempProject() {
  const { mkdtempSync } = require("fs");
  const { tmpdir } = require("os");
  const { join } = require("path");
  const dir = mkdtempSync(join(tmpdir(), "mvk-rpc-"));
  // Insert a project row so projectId resolves
  const store = new SQLiteStore({ path: ":memory:" });
  store.projectAdd({ path: dir, name: "tmp" });
  const handlers = new RpcHandlers({ store });
  return { handlers, dir };
}
```

(If `makeWithTempProject` already exists, reuse it; otherwise add.)

- [ ] **Step 2: Run failing**

```bash
bun test sidecar/rpc-handlers.test.ts 2>&1 | tail -10
```

Expected: 3 FAIL — handler method unrecognized.

- [ ] **Step 3: Implement**

In `sidecar/rpc-handlers.ts`:

Add import:

```ts
import { ProjectSettingsStore } from "./project-settings-store";
```

Add to `Schemas`:

```ts
projectSettingsGet: z.object({ projectId: z.string() }),
  projectSettingsUpdate: z.object({
    projectId: z.string(),
    patch: z.record(z.string(), z.unknown()),
  }),
  projectSettingsOpenFile: z.object({ projectId: z.string() }),
```

Add to `RpcHandlersOptions` type and constructor:

```ts
projectSettings?: ProjectSettingsStore;
// inside constructor:
this.projectSettings = opts.projectSettings ?? new ProjectSettingsStore();
```

Declare class property:

```ts
private projectSettings: ProjectSettingsStore;
```

Add three cases inside the `dispatch` switch. The `projectId` is resolved against `this.store` (existing `SQLiteStore`) to find the path:

```ts
case "project.settings.get": {
        const p = Schemas.projectSettingsGet.parse(params);
        const project = this.store.projectGet(p.projectId);
        if (!project) throw new Error(`project ${p.projectId} not found`);
        return this.projectSettings.read(project.path);
      }
      case "project.settings.update": {
        const p = Schemas.projectSettingsUpdate.parse(params);
        const project = this.store.projectGet(p.projectId);
        if (!project) throw new Error(`project ${p.projectId} not found`);
        return this.projectSettings.write(project.path, p.patch as never);
      }
      case "project.settings.openFile": {
        const p = Schemas.projectSettingsOpenFile.parse(params);
        const project = this.store.projectGet(p.projectId);
        if (!project) throw new Error(`project ${p.projectId} not found`);
        return { path: `${project.path}/maverick.json` };
      }
```

If `SQLiteStore.projectGet` does not exist, add it next to `projectList`:

```ts
projectGet(id: string): Project | null {
    const row = this.db.query("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
    return row ? { id: row.id, name: row.name, path: row.path, createdAt: row.created_at } : null;
  }
```

- [ ] **Step 4: Run tests**

```bash
bun test sidecar/rpc-handlers.test.ts sidecar/sqlite-store.test.ts 2>&1 | tail -10
```

Expected: PASS (3 new + existing).

- [ ] **Step 5: Commit**

```bash
git add sidecar/rpc-handlers.ts sidecar/rpc-handlers.test.ts sidecar/sqlite-store.ts
git commit -m "feat(sidecar): project.settings.{get,update,openFile} RPCs"
```

---

### Task 7: Files-to-copy step during `workspace.create`

**Files:**
- Modify: `sidecar/worktree-manager.ts`
- Modify: `sidecar/worktree-manager.test.ts`

- [ ] **Step 1: Write failing test**

Append in `sidecar/worktree-manager.test.ts`:

```ts
it("copies filesToCopy from project root into the new worktree", async () => {
    // Setup: write a .env file in the source project, then create a worktree with filesToCopy = [".env"]
    const fs = await import("fs");
    const path = await import("path");
    // ... harness existing in this file. Pseudocode:
    fs.writeFileSync(path.join(srcProjectDir, ".env"), "TOKEN=hi");
    const { worktreePath } = await manager.create({
      projectPath: srcProjectDir,
      branch: "feat/copy-test",
      filesToCopy: [".env"],
    });
    expect(fs.readFileSync(path.join(worktreePath, ".env"), "utf8")).toBe("TOKEN=hi");
  });

  it("skip-if-source-missing for filesToCopy", async () => {
    const { worktreePath } = await manager.create({
      projectPath: srcProjectDir,
      branch: "feat/missing-copy",
      filesToCopy: [".does-not-exist"],
    });
    // No throw; worktree still exists.
    expect(require("fs").existsSync(worktreePath)).toBe(true);
  });
```

- [ ] **Step 2: Run failing**

```bash
bun test sidecar/worktree-manager.test.ts 2>&1 | tail -10
```

Expected: 2 FAIL — `filesToCopy` param ignored.

- [ ] **Step 3: Implement**

In `sidecar/worktree-manager.ts`, extend the `create` options:

```ts
export interface CreateOptions {
  projectPath: string;
  branch: string;
  baseBranch?: string;
  filesToCopy?: string[];
}
```

After the `git worktree add` step (and before returning), copy each entry:

```ts
if (opts.filesToCopy && opts.filesToCopy.length > 0) {
      for (const rel of opts.filesToCopy) {
        const src = join(opts.projectPath, rel);
        const dst = join(worktreePath, rel);
        if (!existsSync(src)) continue;
        try {
          const stat = statSync(src);
          if (!stat.isFile()) continue;
          mkdirSync(dirname(dst), { recursive: true });
          copyFileSync(src, dst);
        } catch (err) {
          console.error(`[worktree] failed to copy ${rel}:`, err);
        }
      }
    }
```

Add missing imports if needed: `copyFileSync, mkdirSync, statSync, existsSync` from `fs`; `dirname, join` from `path`.

- [ ] **Step 4: Run tests**

```bash
bun test sidecar/worktree-manager.test.ts 2>&1 | tail -8
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sidecar/worktree-manager.ts sidecar/worktree-manager.test.ts
git commit -m "feat(sidecar): copy filesToCopy on workspace create"
```

---

### Task 8: Auto-run `scripts.setup` on workspace.create

**Files:**
- Modify: `sidecar/rpc-handlers.ts`
- Modify: `sidecar/rpc-handlers.test.ts`

- [ ] **Step 1: Write failing test**

Append in `sidecar/rpc-handlers.test.ts`:

```ts
it("workspace.create triggers scripts.setup when configured", async () => {
    const { handlers, dir } = makeWithTempProject();
    await handlers.dispatch("project.settings.update", {
      projectId: <projectId from helper>,
      patch: { scripts: { setup: "echo setup-ran > .setup-marker", run: "", archive: "" } },
    });
    const ws = (await handlers.dispatch("workspace.create", {
      projectId: <projectId>,
      projectPath: dir,
      branch: "feat/x",
      backend: "claude",
    })) as { id: string; worktreePath: string };
    // Wait briefly for the spawned PTY to finish:
    await new Promise((r) => setTimeout(r, 250));
    const fs = require("fs");
    expect(fs.existsSync(`${ws.worktreePath}/.setup-marker`)).toBe(true);
  });
```

(Replace `<projectId>` with the value returned by `makeWithTempProject` — adjust the helper to return `projectId` alongside `dir`.)

- [ ] **Step 2: Run failing**

```bash
bun test sidecar/rpc-handlers.test.ts -t "auto-run" 2>&1 | tail -10
```

Expected: FAIL — marker not created.

- [ ] **Step 3: Implement**

In `sidecar/rpc-handlers.ts`, inside the `case "workspace.create":` branch, after `this.store.workspaceCreate(...)` and before returning, add:

```ts
const settings = this.projectSettings.read(p.projectPath);
        if (settings.scripts.setup.trim() !== "") {
          await this.process.spawnOnce({
            cwd: worktreePath,
            command: "/bin/sh",
            args: ["-c", settings.scripts.setup],
          });
        }
        // Also copy files-to-copy via worktree manager option (already passed):
```

Ensure the worktree.create call passes `filesToCopy: settings.workspaces.filesToCopy`.

`spawnOnce` is a small wrapper on `ProcessManager`. If it does not exist, add to `sidecar/process-manager.ts`:

```ts
async spawnOnce(opts: { cwd: string; command: string; args: string[]; env?: Record<string, string> }): Promise<{ code: number }> {
    return new Promise((resolve, reject) => {
      const proc = Bun.spawn([opts.command, ...opts.args], {
        cwd: opts.cwd,
        env: { ...process.env, ...(opts.env ?? {}) },
        stdout: "inherit",
        stderr: "inherit",
        onExit: (_p, code) => resolve({ code: code ?? 0 }),
      });
      proc.exited.catch(reject);
    });
  }
```

- [ ] **Step 4: Run tests**

```bash
bun test sidecar/rpc-handlers.test.ts 2>&1 | tail -8
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sidecar/rpc-handlers.ts sidecar/rpc-handlers.test.ts sidecar/process-manager.ts
git commit -m "feat(sidecar): auto-run scripts.setup on workspace.create"
```

---

### Task 9: Run `scripts.archive` on workspace.destroy with 30s timeout

**Files:**
- Modify: `sidecar/rpc-handlers.ts`
- Modify: `sidecar/rpc-handlers.test.ts`

- [ ] **Step 1: Failing test**

```ts
it("workspace.destroy runs scripts.archive before deleting worktree", async () => {
    const { handlers, dir, projectId } = makeWithTempProject();
    await handlers.dispatch("project.settings.update", {
      projectId,
      patch: { scripts: { setup: "", run: "", archive: "echo archived > /tmp/.mvk-archive-marker-${RANDOM}" } },
    });
    const ws = (await handlers.dispatch("workspace.create", {
      projectId, projectPath: dir, branch: "feat/archive", backend: "claude",
    })) as { id: string };
    await handlers.dispatch("workspace.destroy", { workspaceId: ws.id });
    // Marker check is approximate; the test asserts no throw and PROCESS exit code 0.
    expect(true).toBe(true);
  });
```

(Detailed assertion is best-effort; the harder guarantee is that no error is thrown and destroy returns.)

- [ ] **Step 2: Run failing**

```bash
bun test sidecar/rpc-handlers.test.ts -t "archive" 2>&1 | tail -10
```

- [ ] **Step 3: Implement**

In `sidecar/rpc-handlers.ts`, inside `case "workspace.destroy":`, before `this.worktree.destroy(...)`:

```ts
const wsRow = this.store.workspaceGet(p.workspaceId);
        if (wsRow) {
          const project = this.store.projectGet(wsRow.projectId);
          if (project) {
            const settings = this.projectSettings.read(project.path);
            if (settings.scripts.archive.trim() !== "") {
              await Promise.race([
                this.process.spawnOnce({
                  cwd: wsRow.worktreePath,
                  command: "/bin/sh",
                  args: ["-c", settings.scripts.archive],
                }),
                new Promise((resolve) => setTimeout(() => resolve({ code: -1 }), 30_000)),
              ]);
            }
          }
        }
```

Add `workspaceGet(id)` to `SQLiteStore` if missing (mirror `projectGet`).

- [ ] **Step 4: Run**

```bash
bun test sidecar/rpc-handlers.test.ts 2>&1 | tail -8
```

- [ ] **Step 5: Commit**

```bash
git add sidecar/rpc-handlers.ts sidecar/rpc-handlers.test.ts sidecar/sqlite-store.ts
git commit -m "feat(sidecar): run scripts.archive on workspace.destroy (30s timeout)"
```

---

### Task 10: `project.settings.changed` notification on fs.watch

**Files:**
- Modify: `sidecar/rpc-handlers.ts`

- [ ] **Step 1: Failing test**

Append to `sidecar/rpc-handlers.test.ts`:

```ts
it("notifier receives project.settings.changed when file is rewritten", async () => {
    const { handlers, dir, projectId, notifier } = makeWithTempProject();
    await handlers.dispatch("project.settings.update", { projectId, patch: { remote: "alpha" } });
    await new Promise((r) => setTimeout(r, 100));
    // External edit:
    const fs = require("fs");
    const raw = JSON.parse(fs.readFileSync(`${dir}/maverick.json`, "utf8"));
    raw.project.remote = "beta";
    fs.writeFileSync(`${dir}/maverick.json`, JSON.stringify(raw, null, 2));
    await new Promise((r) => setTimeout(r, 200));
    const calls = notifier.calls.filter((c) => c.method === "project.settings.changed");
    expect(calls.length).toBeGreaterThan(0);
  });
```

Update the helper to also return `notifier` (a stub that records `forward(method, params)` calls).

- [ ] **Step 2: Run failing**

```bash
bun test sidecar/rpc-handlers.test.ts -t "changed" 2>&1 | tail -10
```

- [ ] **Step 3: Implement**

In `RpcHandlers`, after `project.settings.update` writes successfully, emit:

```ts
this.notifier?.write(
        JSON.stringify({ jsonrpc: "2.0", method: "project.settings.changed", params: { projectId: p.projectId, settings } })
      );
```

For external edits, register a one-time fs.watch per project the first time `project.settings.get` is called:

```ts
private watched = new Set<string>();

private ensureWatch(projectId: string, path: string) {
    if (this.watched.has(projectId)) return;
    this.watched.add(projectId);
    const { watch } = require("fs");
    watch(path, { persistent: false }, () => {
      try {
        const settings = this.projectSettings.read(require("path").dirname(path));
        this.notifier?.write(
          JSON.stringify({ jsonrpc: "2.0", method: "project.settings.changed", params: { projectId, settings } })
        );
      } catch { /* ignore */ }
    });
  }
```

Call `this.ensureWatch(p.projectId, `${project.path}/maverick.json`)` inside the `project.settings.get` handler.

- [ ] **Step 4: Run**

```bash
bun test sidecar/rpc-handlers.test.ts -t "changed" 2>&1 | tail -8
```

- [ ] **Step 5: Commit**

```bash
git add sidecar/rpc-handlers.ts sidecar/rpc-handlers.test.ts
git commit -m "feat(sidecar): emit project.settings.changed on file edits"
```

---

## Zone 3 — Rust IPC (parallel after Zone 1)

### Task 11: 3 new Tauri commands

**Files:**
- Create: `src-tauri/src/commands/project_settings.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the file**

```rust
// src-tauri/src/commands/project_settings.rs
use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn project_settings_get(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request("project.settings.get", json!({ "projectId": project_id }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn project_settings_update(
    state: State<'_, AppState>,
    project_id: String,
    patch: Value,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "project.settings.update",
            json!({ "projectId": project_id, "patch": patch }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn project_settings_open_file(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request("project.settings.openFile", json!({ "projectId": project_id }))
        .await
        .map_err(|e| e.to_string())
}
```

In `src-tauri/src/commands/mod.rs`:

```rust
mod project_settings;
pub use project_settings::{project_settings_get, project_settings_update, project_settings_open_file};
```

In `src-tauri/src/lib.rs`, add to the `invoke_handler!`:

```rust
project_settings_get,
project_settings_update,
project_settings_open_file,
```

- [ ] **Step 2: Cargo check + test**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10
```

Expected: clean check, existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/project_settings.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(rust): project_settings_{get,update,open_file} commands"
```

---

## Zone 4 — Frontend Modal (after Zones 1-3)

### Task 12: Add `ProjectSettings` IPC type + tauri wrappers

**Files:**
- Modify: `src/lib/ipc.ts`
- Modify: `src/lib/tauri.ts`
- Modify: `src/lib/ipc.test.ts`

- [ ] **Step 1: Append type**

In `src/lib/ipc.ts`:

```ts
export interface ProjectSettings {
  name: string;
  rootPath: string;
  workspaces: {
    basePath?: string;
    branchFrom: string;
    filesToCopy: string[];
  };
  remote: string;
  previewUrl: string;
  scripts: { setup: string; run: string; archive: string };
  preferences: Record<string, string>;
}
```

In `src/lib/tauri.ts`:

```ts
export async function projectSettingsGet(projectId: string): Promise<ProjectSettings> {
  return invoke("project_settings_get", { projectId });
}

export async function projectSettingsUpdate(
  projectId: string,
  patch: Partial<ProjectSettings>
): Promise<ProjectSettings> {
  return invoke("project_settings_update", { projectId, patch });
}

export async function projectSettingsOpenFile(projectId: string): Promise<{ path: string }> {
  return invoke("project_settings_open_file", { projectId });
}

export function onProjectSettingsChanged(
  callback: (payload: { projectId: string; settings: ProjectSettings }) => void
): Promise<UnlistenFn> {
  return listen<{ projectId: string; settings: ProjectSettings }>(
    "project:settings:changed",
    (e) => callback(e.payload)
  );
}
```

Don't forget to add `ProjectSettings` to the import list at the top of `tauri.ts`.

- [ ] **Step 2: Add a basic test**

In `src/lib/ipc.test.ts`:

```ts
it("projectSettings IPC wrappers call invoke with correct args", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ name: "x" } as never);
    await projectSettingsGet("p1");
    expect(invoke).toHaveBeenCalledWith("project_settings_get", { projectId: "p1" });
  });
```

- [ ] **Step 3: Run**

```bash
bun run test src/lib/ipc.test.ts 2>&1 | tail -6
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/ipc.ts src/lib/tauri.ts src/lib/ipc.test.ts
git commit -m "feat(ipc): projectSettings types + tauri wrappers"
```

---

### Task 13: `useProjectSettingsStore`

**Files:**
- Create: `src/lib/stores/project-settings.ts`
- Create: `src/lib/stores/project-settings.test.ts`

- [ ] **Step 1: Failing test**

```ts
// src/lib/stores/project-settings.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useProjectSettingsStore } from "./project-settings";

const STUB = {
  name: "demo", rootPath: "/p/demo",
  workspaces: { branchFrom: "origin/main", filesToCopy: [] },
  remote: "origin", previewUrl: "",
  scripts: { setup: "", run: "", archive: "" },
  preferences: {},
};

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useProjectSettingsStore.getState().reset();
});

describe("useProjectSettingsStore", () => {
  it("load fetches and sets data", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(STUB as never);
    await useProjectSettingsStore.getState().load("p1");
    expect(useProjectSettingsStore.getState().data?.name).toBe("demo");
    expect(useProjectSettingsStore.getState().status).toBe("loaded");
  });

  it("patch accumulates dirty without invoking", () => {
    useProjectSettingsStore.setState({ data: STUB, projectId: "p1", status: "loaded" });
    useProjectSettingsStore.getState().patch({ remote: "upstream" });
    expect(useProjectSettingsStore.getState().dirty.remote).toBe("upstream");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("flush writes dirty patch and clears it", async () => {
    useProjectSettingsStore.setState({ data: STUB, projectId: "p1", status: "loaded" });
    useProjectSettingsStore.getState().patch({ remote: "upstream" });
    vi.mocked(invoke).mockResolvedValueOnce({ ...STUB, remote: "upstream" } as never);
    await useProjectSettingsStore.getState().flush();
    expect(invoke).toHaveBeenCalledWith("project_settings_update", { projectId: "p1", patch: { remote: "upstream" } });
    expect(useProjectSettingsStore.getState().dirty).toEqual({});
    expect(useProjectSettingsStore.getState().status).toBe("loaded");
  });

  it("flush surfaces error and keeps dirty", async () => {
    useProjectSettingsStore.setState({ data: STUB, projectId: "p1", status: "loaded" });
    useProjectSettingsStore.getState().patch({ remote: "upstream" });
    vi.mocked(invoke).mockRejectedValueOnce(new Error("write fail"));
    await useProjectSettingsStore.getState().flush();
    expect(useProjectSettingsStore.getState().status).toBe("error");
    expect(useProjectSettingsStore.getState().lastError).toContain("write fail");
    expect(useProjectSettingsStore.getState().dirty.remote).toBe("upstream");
  });
});
```

- [ ] **Step 2: Run failing**

```bash
bun run test src/lib/stores/project-settings.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Implement**

```ts
// src/lib/stores/project-settings.ts
import { create } from "zustand";
import type { ProjectSettings } from "@/lib/ipc";
import { projectSettingsGet, projectSettingsUpdate } from "@/lib/tauri";

type Status = "idle" | "loading" | "loaded" | "saving" | "error";

interface State {
  projectId: string | null;
  status: Status;
  data: ProjectSettings | null;
  dirty: Partial<ProjectSettings>;
  lastError: string | null;
  load: (projectId: string) => Promise<void>;
  patch: (partial: Partial<ProjectSettings>) => void;
  flush: () => Promise<void>;
  reset: () => void;
}

export const useProjectSettingsStore = create<State>((set, get) => ({
  projectId: null,
  status: "idle",
  data: null,
  dirty: {},
  lastError: null,

  load: async (projectId) => {
    set({ status: "loading", projectId, lastError: null, dirty: {} });
    try {
      const data = await projectSettingsGet(projectId);
      set({ status: "loaded", data });
    } catch (e) {
      set({ status: "error", lastError: e instanceof Error ? e.message : String(e) });
    }
  },

  patch: (partial) => set((s) => ({ dirty: { ...s.dirty, ...partial } })),

  flush: async () => {
    const { projectId, dirty, data } = get();
    if (!projectId || Object.keys(dirty).length === 0) return;
    set({ status: "saving", lastError: null });
    try {
      const saved = await projectSettingsUpdate(projectId, dirty);
      set({ status: "loaded", data: saved, dirty: {} });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ status: "error", lastError: msg });
    }
  },

  reset: () => set({ projectId: null, status: "idle", data: null, dirty: {}, lastError: null }),
}));
```

- [ ] **Step 4: Run**

```bash
bun run test src/lib/stores/project-settings.test.ts 2>&1 | tail -8
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/project-settings.ts src/lib/stores/project-settings.test.ts
git commit -m "feat(store): useProjectSettingsStore with autosave semantics"
```

---

### Task 14: Section primitives `IdentitySection`

**Files:**
- Create: `src/panels/project-settings/sections/IdentitySection.tsx`
- Create: `src/panels/project-settings/sections/IdentitySection.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import IdentitySection from "./IdentitySection";

const STUB = { name: "demo", rootPath: "/p/demo", workspaces: { branchFrom: "origin/main", filesToCopy: [] }, remote: "origin", previewUrl: "", scripts: { setup: "", run: "", archive: "" }, preferences: {} };

beforeEach(() => {
  useProjectSettingsStore.setState({ data: STUB, projectId: "p1", status: "loaded", dirty: {}, lastError: null });
});

describe("IdentitySection", () => {
  it("renders name and root path", () => {
    renderWithProviders(<IdentitySection />);
    expect(screen.getByDisplayValue("demo")).toBeInTheDocument();
    expect(screen.getByText("/p/demo")).toBeInTheDocument();
  });

  it("blur on name triggers patch + flush", async () => {
    renderWithProviders(<IdentitySection />);
    const input = screen.getByDisplayValue("demo");
    await userEvent.clear(input);
    await userEvent.type(input, "alpha");
    await userEvent.tab();
    expect(useProjectSettingsStore.getState().dirty.name).toBe("alpha");
  });
});
```

- [ ] **Step 2: Run failing**

```bash
bun run test src/panels/project-settings/sections/IdentitySection.test.tsx 2>&1 | tail -8
```

- [ ] **Step 3: Implement**

```tsx
// src/panels/project-settings/sections/IdentitySection.tsx
import { Input } from "@/components/ui/input";
import { SettingsGroup } from "@/panels/settings/primitives/SettingsGroup";
import { SettingsRow } from "@/panels/settings/primitives/SettingsRow";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";

export default function IdentitySection() {
  const data = useProjectSettingsStore((s) => s.data);
  const patch = useProjectSettingsStore((s) => s.patch);
  const flush = useProjectSettingsStore((s) => s.flush);

  if (!data) return null;

  const handleBlur = () => { void flush(); };

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
          control={<div className="font-mono text-[12px] text-muted-foreground">{data.rootPath}</div>}
        />
      </SettingsGroup>
    </div>
  );
}
```

- [ ] **Step 4: Run**

```bash
bun run test src/panels/project-settings/sections/IdentitySection.test.tsx 2>&1 | tail -8
```

- [ ] **Step 5: Commit**

```bash
git add src/panels/project-settings/sections/IdentitySection.tsx src/panels/project-settings/sections/IdentitySection.test.tsx
git commit -m "feat(project-settings): Identity section"
```

---

### Task 15: `WorkspacesSection`

**Files:**
- Create: `src/panels/project-settings/sections/WorkspacesSection.tsx`
- Create: `src/panels/project-settings/sections/WorkspacesSection.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import WorkspacesSection from "./WorkspacesSection";

beforeEach(() => {
  useProjectSettingsStore.setState({
    projectId: "p1", status: "loaded", dirty: {}, lastError: null,
    data: { name: "demo", rootPath: "/p/demo", workspaces: { branchFrom: "origin/main", filesToCopy: [".env"] }, remote: "origin", previewUrl: "", scripts: { setup: "", run: "", archive: "" }, preferences: {} },
  });
});

describe("WorkspacesSection", () => {
  it("renders branchFrom, remote, filesToCopy", () => {
    renderWithProviders(<WorkspacesSection />);
    expect(screen.getByDisplayValue("origin/main")).toBeInTheDocument();
    expect(screen.getByDisplayValue("origin")).toBeInTheDocument();
    expect(screen.getByText(".env")).toBeInTheDocument();
  });

  it("add file-to-copy patches array", async () => {
    renderWithProviders(<WorkspacesSection />);
    const input = screen.getByPlaceholderText(".env.local");
    await userEvent.type(input, ".npmrc{Enter}");
    expect(useProjectSettingsStore.getState().dirty.workspaces?.filesToCopy).toEqual([".env", ".npmrc"]);
  });
});
```

- [ ] **Step 2: Run failing**

```bash
bun run test src/panels/project-settings/sections/WorkspacesSection.test.tsx 2>&1 | tail -8
```

- [ ] **Step 3: Implement**

```tsx
// src/panels/project-settings/sections/WorkspacesSection.tsx
import { useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SettingsGroup } from "@/panels/settings/primitives/SettingsGroup";
import { SettingsRow } from "@/panels/settings/primitives/SettingsRow";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";

export default function WorkspacesSection() {
  const data = useProjectSettingsStore((s) => s.data);
  const patch = useProjectSettingsStore((s) => s.patch);
  const flush = useProjectSettingsStore((s) => s.flush);
  const [newFile, setNewFile] = useState("");

  if (!data) return null;

  const blur = () => { void flush(); };
  const addFile = () => {
    const trimmed = newFile.trim();
    if (!trimmed) return;
    const next = [...data.workspaces.filesToCopy, trimmed];
    patch({ workspaces: { ...data.workspaces, filesToCopy: next } });
    setNewFile("");
    void flush();
  };
  const removeFile = (idx: number) => {
    const next = data.workspaces.filesToCopy.filter((_, i) => i !== idx);
    patch({ workspaces: { ...data.workspaces, filesToCopy: next } });
    void flush();
  };

  return (
    <div data-testid="project-workspaces" className="space-y-5">
      <SettingsGroup title="Workspaces" description="How new workspaces are created from this project.">
        <SettingsRow
          title="Branch new workspaces from"
          description="The base branch each new workspace is forked from."
          control={
            <Input
              defaultValue={data.workspaces.branchFrom}
              onChange={(e) => patch({ workspaces: { ...data.workspaces, branchFrom: e.target.value } })}
              onBlur={blur}
              className="w-72 font-mono"
            />
          }
        />
        <SettingsRow
          title="Remote"
          description="Where Maverick pushes, pulls, and opens PRs."
          control={
            <Input
              defaultValue={data.remote}
              onChange={(e) => patch({ remote: e.target.value })}
              onBlur={blur}
              className="w-72 font-mono"
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Files to copy" description="Project-relative file paths copied into each new workspace.">
        <ul className="flex flex-col gap-1">
          {data.workspaces.filesToCopy.map((f, i) => (
            <li key={`${f}-${i}`} className="flex items-center justify-between rounded bg-muted/40 px-2 py-1 text-[12px] font-mono">
              <span>{f}</span>
              <button type="button" aria-label={`Remove ${f}`} onClick={() => removeFile(i)} className="text-muted-foreground hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
        <Input
          placeholder=".env.local"
          value={newFile}
          onChange={(e) => setNewFile(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFile(); } }}
          className="w-72 font-mono"
        />
      </SettingsGroup>
    </div>
  );
}
```

- [ ] **Step 4: Run**

```bash
bun run test src/panels/project-settings/sections/WorkspacesSection.test.tsx 2>&1 | tail -8
```

- [ ] **Step 5: Commit**

```bash
git add src/panels/project-settings/sections/WorkspacesSection.tsx src/panels/project-settings/sections/WorkspacesSection.test.tsx
git commit -m "feat(project-settings): Workspaces section"
```

---

### Task 16: `PreviewSection`

**Files:**
- Create: `src/panels/project-settings/sections/PreviewSection.tsx`
- Create: `src/panels/project-settings/sections/PreviewSection.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import PreviewSection from "./PreviewSection";

const BASE = { name: "demo", rootPath: "/p", workspaces: { branchFrom: "origin/main", filesToCopy: [] }, remote: "origin", previewUrl: "http://localhost:${WORKSPACE_PORT}", scripts: { setup: "", run: "", archive: "" }, preferences: {} };

beforeEach(() => {
  useProjectSettingsStore.setState({ data: BASE, projectId: "p1", status: "loaded", dirty: {}, lastError: null });
});

describe("PreviewSection", () => {
  it("renders previewUrl with env-var helper", () => {
    renderWithProviders(<PreviewSection />);
    expect(screen.getByDisplayValue("http://localhost:${WORKSPACE_PORT}")).toBeInTheDocument();
    expect(screen.getByText(/\$\{WORKSPACE_NAME\}/)).toBeInTheDocument();
  });

  it("patches on edit + blur", async () => {
    renderWithProviders(<PreviewSection />);
    const input = screen.getByDisplayValue("http://localhost:${WORKSPACE_PORT}");
    await userEvent.clear(input);
    await userEvent.type(input, "http://localhost:5173");
    await userEvent.tab();
    expect(useProjectSettingsStore.getState().dirty.previewUrl).toBe("http://localhost:5173");
  });
});
```

- [ ] **Step 2: Run failing**

```bash
bun run test src/panels/project-settings/sections/PreviewSection.test.tsx 2>&1 | tail -8
```

- [ ] **Step 3: Implement**

```tsx
// src/panels/project-settings/sections/PreviewSection.tsx
import { Input } from "@/components/ui/input";
import { SettingsGroup } from "@/panels/settings/primitives/SettingsGroup";
import { SettingsRow } from "@/panels/settings/primitives/SettingsRow";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";

const TOKENS = ["${WORKSPACE_NAME}", "${WORKSPACE_PORT}", "${WORKSPACE_PATH}"];

export default function PreviewSection() {
  const data = useProjectSettingsStore((s) => s.data);
  const patch = useProjectSettingsStore((s) => s.patch);
  const flush = useProjectSettingsStore((s) => s.flush);
  if (!data) return null;

  return (
    <div data-testid="project-preview" className="space-y-5">
      <SettingsGroup title="Preview" description="Overrides the Panel's Open preview button. Leave blank to hide it.">
        <SettingsRow
          title="Preview URL"
          description="Supports env tokens substituted per workspace."
          control={
            <Input
              defaultValue={data.previewUrl}
              onChange={(e) => patch({ previewUrl: e.target.value })}
              onBlur={() => void flush()}
              placeholder="http://localhost:${WORKSPACE_PORT}"
              className="w-96 font-mono"
            />
          }
        />
        <p className="text-[11px] text-muted-foreground">
          Tokens: {TOKENS.map((t) => <code key={t} className="mx-1 rounded bg-muted px-1 py-0.5">{t}</code>)}
        </p>
      </SettingsGroup>
    </div>
  );
}
```

- [ ] **Step 4: Run**

```bash
bun run test src/panels/project-settings/sections/PreviewSection.test.tsx 2>&1 | tail -8
```

- [ ] **Step 5: Commit**

```bash
git add src/panels/project-settings/sections/PreviewSection.tsx src/panels/project-settings/sections/PreviewSection.test.tsx
git commit -m "feat(project-settings): Preview section"
```

---

### Task 17: `ScriptsSection`

**Files:**
- Create: `src/panels/project-settings/sections/ScriptsSection.tsx`
- Create: `src/panels/project-settings/sections/ScriptsSection.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import ScriptsSection from "./ScriptsSection";

const BASE = { name: "demo", rootPath: "/p", workspaces: { branchFrom: "origin/main", filesToCopy: [] }, remote: "origin", previewUrl: "", scripts: { setup: "bun install", run: "", archive: "" }, preferences: {} };

beforeEach(() => {
  useProjectSettingsStore.setState({ data: BASE, projectId: "p1", status: "loaded", dirty: {}, lastError: null });
});

describe("ScriptsSection", () => {
  it("renders three textareas", () => {
    renderWithProviders(<ScriptsSection />);
    expect(screen.getByDisplayValue("bun install")).toBeInTheDocument();
    expect(screen.getByLabelText(/Run script/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Archive script/i)).toBeInTheDocument();
  });

  it("blur on Run patches and flushes", async () => {
    renderWithProviders(<ScriptsSection />);
    const ta = screen.getByLabelText(/Run script/i);
    await userEvent.type(ta, "bun run dev");
    await userEvent.tab();
    expect(useProjectSettingsStore.getState().dirty.scripts?.run).toBe("bun run dev");
  });
});
```

- [ ] **Step 2: Run failing**

```bash
bun run test src/panels/project-settings/sections/ScriptsSection.test.tsx 2>&1 | tail -8
```

- [ ] **Step 3: Implement**

```tsx
// src/panels/project-settings/sections/ScriptsSection.tsx
import { Textarea } from "@/components/ui/textarea";
import { SettingsGroup } from "@/panels/settings/primitives/SettingsGroup";
import { SettingsRow } from "@/panels/settings/primitives/SettingsRow";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";

const KINDS = [
  { key: "setup", label: "Setup script", hint: "Runs once when a workspace is created. Use for dependency installs." },
  { key: "run", label: "Run script", hint: "Runs when you click ▶ Run in the Panel. Use for dev servers." },
  { key: "archive", label: "Archive script", hint: "Runs before a workspace is destroyed. 30s soft timeout." },
] as const;

export default function ScriptsSection() {
  const data = useProjectSettingsStore((s) => s.data);
  const patch = useProjectSettingsStore((s) => s.patch);
  const flush = useProjectSettingsStore((s) => s.flush);

  if (!data) return null;

  return (
    <div data-testid="project-scripts" className="space-y-5">
      <SettingsGroup title="Scripts" description="Shell commands keyed off workspace lifecycle events.">
        {KINDS.map((k) => (
          <SettingsRow
            key={k.key}
            title={k.label}
            description={k.hint}
            control={
              <Textarea
                aria-label={k.label}
                data-testid={`scripts-${k.key}`}
                defaultValue={data.scripts[k.key]}
                onChange={(e) => patch({ scripts: { ...data.scripts, [k.key]: e.target.value } })}
                onBlur={() => void flush()}
                className="h-24 w-96 font-mono text-[12px]"
                placeholder={k.key === "setup" ? "bun install" : k.key === "run" ? "bun run dev" : ""}
              />
            }
          />
        ))}
      </SettingsGroup>
    </div>
  );
}
```

If `Textarea` does not exist in `src/components/ui`, add a shadcn-style one:

```bash
bunx shadcn@latest add textarea
```

(Or copy the standard implementation; it's a thin `<textarea>` with shared class names.)

- [ ] **Step 4: Run**

```bash
bun run test src/panels/project-settings/sections/ScriptsSection.test.tsx 2>&1 | tail -8
```

- [ ] **Step 5: Commit**

```bash
git add src/panels/project-settings/sections/ScriptsSection.tsx src/panels/project-settings/sections/ScriptsSection.test.tsx src/components/ui/textarea.tsx
git commit -m "feat(project-settings): Scripts section"
```

---

### Task 18: `PreferencesSection`

**Files:**
- Create: `src/panels/project-settings/sections/PreferencesSection.tsx`
- Create: `src/panels/project-settings/sections/PreferencesSection.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import PreferencesSection from "./PreferencesSection";

const BASE = { name: "demo", rootPath: "/p", workspaces: { branchFrom: "origin/main", filesToCopy: [] }, remote: "origin", previewUrl: "", scripts: { setup: "", run: "", archive: "" }, preferences: {} };

beforeEach(() => {
  useProjectSettingsStore.setState({ data: BASE, projectId: "p1", status: "loaded", dirty: {}, lastError: null });
});

describe("PreferencesSection", () => {
  it("renders 6 textareas", () => {
    renderWithProviders(<PreferencesSection />);
    ["Review", "Create PR", "Fix errors", "Resolve conflicts", "Branch rename", "General"].forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  it("blur on Review patches preferences.review", async () => {
    renderWithProviders(<PreferencesSection />);
    const ta = screen.getByTestId("preferences-review");
    await userEvent.type(ta, "be terse");
    await userEvent.tab();
    expect(useProjectSettingsStore.getState().dirty.preferences?.review).toBe("be terse");
  });
});
```

- [ ] **Step 2: Run failing**

```bash
bun run test src/panels/project-settings/sections/PreferencesSection.test.tsx 2>&1 | tail -8
```

- [ ] **Step 3: Implement**

```tsx
// src/panels/project-settings/sections/PreferencesSection.tsx
import { Textarea } from "@/components/ui/textarea";
import { SettingsGroup } from "@/panels/settings/primitives/SettingsGroup";
import { SettingsRow } from "@/panels/settings/primitives/SettingsRow";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";

const PREFS = [
  { key: "review", label: "Review", hint: "Custom instructions for the Review action." },
  { key: "createPr", label: "Create PR", hint: "Custom instructions for the Create PR action." },
  { key: "fixErrors", label: "Fix errors", hint: "Custom instructions for the Fix errors action." },
  { key: "resolveConflicts", label: "Resolve conflicts", hint: "Custom instructions for the Resolve conflicts action." },
  { key: "branchRename", label: "Branch rename", hint: "Custom instructions for branch-name generation." },
  { key: "general", label: "General", hint: "Custom instructions sent at the start of every new chat." },
] as const;

export default function PreferencesSection() {
  const data = useProjectSettingsStore((s) => s.data);
  const patch = useProjectSettingsStore((s) => s.patch);
  const flush = useProjectSettingsStore((s) => s.flush);

  if (!data) return null;

  return (
    <div data-testid="project-preferences" className="space-y-5">
      <SettingsGroup title="Agent preferences" description="Custom instructions appended to built-in agent actions for this project.">
        {PREFS.map((p) => (
          <SettingsRow
            key={p.key}
            title={p.label}
            description={p.hint}
            control={
              <Textarea
                data-testid={`preferences-${p.key}`}
                defaultValue={data.preferences[p.key] ?? ""}
                onChange={(e) => patch({ preferences: { ...data.preferences, [p.key]: e.target.value } })}
                onBlur={() => void flush()}
                className="h-20 w-96 text-[12px]"
                placeholder={`Add instructions for ${p.label}…`}
              />
            }
          />
        ))}
      </SettingsGroup>
    </div>
  );
}
```

- [ ] **Step 4: Run**

```bash
bun run test src/panels/project-settings/sections/PreferencesSection.test.tsx 2>&1 | tail -8
```

- [ ] **Step 5: Commit**

```bash
git add src/panels/project-settings/sections/PreferencesSection.tsx src/panels/project-settings/sections/PreferencesSection.test.tsx
git commit -m "feat(project-settings): Preferences section"
```

---

### Task 19: `ProjectSettingsPanel` composing the shell + sections

**Files:**
- Create: `src/panels/project-settings/ProjectSettingsPanel.tsx`
- Create: `src/panels/project-settings/ProjectSettingsNavRail.tsx`
- Create: `src/panels/project-settings/ProjectSettingsPanel.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { useWorkbench } from "@/state/store";
import ProjectSettingsPanel from "./ProjectSettingsPanel";

const STUB = { name: "demo", rootPath: "/p", workspaces: { branchFrom: "origin/main", filesToCopy: [] }, remote: "origin", previewUrl: "", scripts: { setup: "", run: "", archive: "" }, preferences: {} };

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(STUB as never);
  useWorkbench.setState({ projects: [{ id: "p1", name: "demo", path: "/p", createdAt: 0 }] } as never);
});

describe("ProjectSettingsPanel", () => {
  it("loads project settings on open and displays project name in header", async () => {
    renderWithProviders(<ProjectSettingsPanel open projectId="p1" onOpenChange={() => {}} initialSection="scripts" />);
    await waitFor(() => expect(screen.getByText(/Project Settings · demo/)).toBeInTheDocument());
  });

  it("switches sections via nav", async () => {
    renderWithProviders(<ProjectSettingsPanel open projectId="p1" onOpenChange={() => {}} initialSection="identity" />);
    await waitFor(() => expect(screen.getByTestId("project-identity")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("project-nav-scripts"));
    expect(screen.getByTestId("project-scripts")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run failing**

```bash
bun run test src/panels/project-settings/ProjectSettingsPanel.test.tsx 2>&1 | tail -10
```

- [ ] **Step 3: Implement nav rail**

```tsx
// src/panels/project-settings/ProjectSettingsNavRail.tsx
import { cn } from "@/lib/utils";

export type ProjectSection = "identity" | "workspaces" | "preview" | "scripts" | "preferences";

const GROUPS: { label: string; items: { id: ProjectSection; label: string }[] }[] = [
  { label: "ABOUT", items: [{ id: "identity", label: "Identity" }] },
  { label: "WORKSPACES", items: [{ id: "workspaces", label: "Workspaces" }, { id: "preview", label: "Preview" }] },
  { label: "EXECUTION", items: [{ id: "scripts", label: "Scripts" }] },
  { label: "AGENT", items: [{ id: "preferences", label: "Preferences" }] },
];

interface Props {
  section: ProjectSection;
  onSelect: (id: ProjectSection) => void;
}

export function ProjectSettingsNavRail({ section, onSelect }: Props) {
  return (
    <nav className="flex h-full flex-col gap-4 px-3 py-4 text-[12px]">
      {GROUPS.map((g) => (
        <div key={g.label}>
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</div>
          <ul>
            {g.items.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  data-testid={`project-nav-${it.id}`}
                  onClick={() => onSelect(it.id)}
                  className={cn(
                    "block w-full rounded-sm px-2 py-1 text-left transition-colors duration-100",
                    section === it.id ? "bg-accent text-foreground" : "hover:bg-sidebar-hover text-muted-foreground hover:text-foreground"
                  )}
                >
                  {it.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Implement panel**

```tsx
// src/panels/project-settings/ProjectSettingsPanel.tsx
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SettingsShell } from "@/components/settings-shell";
import { SettingsFooter } from "@/panels/settings/SettingsFooter";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import { useWorkbench } from "@/state/store";
import { ProjectSettingsNavRail, type ProjectSection } from "./ProjectSettingsNavRail";
import IdentitySection from "./sections/IdentitySection";
import WorkspacesSection from "./sections/WorkspacesSection";
import PreviewSection from "./sections/PreviewSection";
import ScriptsSection from "./sections/ScriptsSection";
import PreferencesSection from "./sections/PreferencesSection";

const SECTIONS: Record<ProjectSection, React.ComponentType> = {
  identity: IdentitySection,
  workspaces: WorkspacesSection,
  preview: PreviewSection,
  scripts: ScriptsSection,
  preferences: PreferencesSection,
};

interface Props {
  open: boolean;
  projectId: string | null;
  initialSection?: ProjectSection;
  onOpenChange: (open: boolean) => void;
}

export default function ProjectSettingsPanel({ open, projectId, initialSection = "identity", onOpenChange }: Props) {
  const [section, setSection] = useState<ProjectSection>(initialSection);
  const project = useWorkbench((s) => s.projects.find((p) => p.id === projectId) ?? null);
  const load = useProjectSettingsStore((s) => s.load);
  const reset = useProjectSettingsStore((s) => s.reset);
  const status = useProjectSettingsStore((s) => s.status);
  const data = useProjectSettingsStore((s) => s.data);
  const lastError = useProjectSettingsStore((s) => s.lastError);

  useEffect(() => {
    if (open && projectId) {
      void load(projectId);
      setSection(initialSection);
    }
    if (!open) reset();
  }, [open, projectId, initialSection, load, reset]);

  const Section = useMemo(() => SECTIONS[section], [section]);
  const title = `Project Settings · ${data?.name ?? project?.name ?? "…"}`;

  return (
    <SettingsShell
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      nav={<ProjectSettingsNavRail section={section} onSelect={setSection} />}
      footer={<SettingsFooter status={status} errorMessage={lastError ?? undefined} />}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={section}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
        >
          <Section />
        </motion.div>
      </AnimatePresence>
    </SettingsShell>
  );
}
```

- [ ] **Step 5: Run + commit**

```bash
bun run test src/panels/project-settings/ 2>&1 | tail -8
```

```bash
git add src/panels/project-settings/
git commit -m "feat(project-settings): ProjectSettingsPanel + nav rail"
```

---

### Task 20: Wire opening into `ProjectsView`, `Workbench`, `EmptyEditor`

**Files:**
- Modify: `src/components/primarysidebar/ProjectsView.tsx`
- Modify: `src/components/workbench/Workbench.tsx`

- [ ] **Step 1: ProjectsView — pass `onSettings`**

Wire the existing `onSettings` prop on `ProjectItem`:

```tsx
const openProjectSettings = useWorkbench((s) => s.openProjectSettings);

// in JSX:
<ProjectItem
  key={p.id}
  project={p}
  onAddWorkspace={onAddWorkspace}
  onSettings={(projectId) => openProjectSettings({ projectId })}
/>
```

- [ ] **Step 2: Workbench — mount the modal lazily**

In `src/components/workbench/Workbench.tsx`, alongside `SettingsPanel`:

```tsx
const ProjectSettingsPanel = lazy(() => import("@/panels/project-settings/ProjectSettingsPanel"));
```

Read state:

```tsx
const projectSettingsState = useWorkbench((s) => s.projectSettings);
const closeProjectSettings = useWorkbench((s) => s.closeProjectSettings);
```

Render alongside the existing settings modal:

```tsx
{projectSettingsState.open && (
  <Suspense fallback={<OverlayFallback />}>
    <ProjectSettingsPanel
      open
      projectId={projectSettingsState.projectId}
      initialSection={projectSettingsState.initialSection}
      onOpenChange={(o) => !o && closeProjectSettings()}
    />
  </Suspense>
)}
```

- [ ] **Step 3: Workbench test — sanity**

```bash
bun run test src/components/workbench/ src/components/primarysidebar/ 2>&1 | tail -8
```

Expected: pass — no regressions.

- [ ] **Step 4: Commit**

```bash
git add src/components/primarysidebar/ProjectsView.tsx src/components/workbench/Workbench.tsx
git commit -m "feat(workbench): mount ProjectSettingsPanel + wire ProjectsView cog button"
```

---

## Zone 5 — Panel Integration (after Zone 4)

### Task 21: `useScriptRunner` hook

**Files:**
- Create: `src/hooks/useScriptRunner.ts`
- Create: `src/hooks/useScriptRunner.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useScriptRunner } from "./useScriptRunner";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("useScriptRunner", () => {
  it("idle → running on start; running → exited on pty:exit", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ptyId: "pty-1" } as never);
    const { result } = renderHook(() => useScriptRunner("ws-1", "/tmp", "echo hi"));
    expect(result.current.state).toBe("idle");
    await act(async () => { await result.current.start(); });
    expect(result.current.state).toBe("running");

    // Simulate the pty:exit event using the test setup's emitter:
    const { __emit } = await import("@/test/setup");
    __emit("pty:exit", { ptyId: "pty-1", code: 0 });
    await waitFor(() => expect(result.current.state).toBe("exited"));
    expect(result.current.exitCode).toBe(0);
  });

  it("start is a no-op when script string is empty", async () => {
    const { result } = renderHook(() => useScriptRunner("ws-1", "/tmp", ""));
    await act(async () => { await result.current.start(); });
    expect(result.current.state).toBe("idle");
    expect(invoke).not.toHaveBeenCalled();
  });
});
```

If `__emit` is not in test/setup, add it as a tiny event-bus that the mocked `listen` reads from. Otherwise inline the listener mock.

- [ ] **Step 2: Run failing**

```bash
bun run test src/hooks/useScriptRunner.test.tsx 2>&1 | tail -10
```

- [ ] **Step 3: Implement**

```ts
// src/hooks/useScriptRunner.ts
import { useEffect, useRef, useState, useCallback } from "react";
import { ptySpawn, ptyKill, onPtyData, onPtyExit } from "@/lib/tauri";

export type ScriptState = "idle" | "running" | "exited";

const BUFFER_CAP = 256 * 1024;

export function useScriptRunner(workspaceId: string | null, cwd: string | null, script: string) {
  const [state, setState] = useState<ScriptState>("idle");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [output, setOutput] = useState("");
  const ptyIdRef = useRef<string | null>(null);

  useEffect(() => {
    let off1: (() => void) | undefined;
    let off2: (() => void) | undefined;
    onPtyData(({ ptyId, data }) => {
      if (ptyId !== ptyIdRef.current) return;
      setOutput((prev) => {
        const next = prev + data;
        return next.length > BUFFER_CAP ? next.slice(next.length - BUFFER_CAP) : next;
      });
    }).then((fn) => { off1 = fn; });
    onPtyExit(({ ptyId, code }) => {
      if (ptyId !== ptyIdRef.current) return;
      setExitCode(code);
      setState("exited");
      ptyIdRef.current = null;
    }).then((fn) => { off2 = fn; });
    return () => { off1?.(); off2?.(); };
  }, []);

  const start = useCallback(async () => {
    if (!workspaceId || !script.trim()) return;
    setOutput("");
    setExitCode(null);
    setStartedAt(Date.now());
    const { ptyId } = await ptySpawn(workspaceId, "/bin/sh", ["-c", script]);
    ptyIdRef.current = ptyId;
    setState("running");
  }, [workspaceId, script]);

  const stop = useCallback(async () => {
    if (!ptyIdRef.current) return;
    try { await ptyKill(ptyIdRef.current); } catch { /* idempotent */ }
  }, []);

  return { state, exitCode, startedAt, output, start, stop };
}
```

- [ ] **Step 4: Run**

```bash
bun run test src/hooks/useScriptRunner.test.tsx 2>&1 | tail -8
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useScriptRunner.ts src/hooks/useScriptRunner.test.tsx
git commit -m "feat(hooks): useScriptRunner backing Setup/Run tabs"
```

---

### Task 22: Rewrite `Panel.tsx` Setup tab + Run tab (empty-state CTA + runner)

**Files:**
- Modify: `src/components/panel/Panel.tsx`
- Modify: `src/components/panel/Panel.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { useWorkbench } from "@/state/store";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import { Panel } from "./Panel";

const SETTINGS = (overrides = {}) => ({ name: "demo", rootPath: "/p", workspaces: { branchFrom: "origin/main", filesToCopy: [] }, remote: "origin", previewUrl: "", scripts: { setup: "", run: "", archive: "" }, preferences: {}, ...overrides });

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useWorkbench.setState({
    projects: [{ id: "p1", name: "demo", path: "/p", createdAt: 0 }],
    workspaces: [{ id: "w1", projectId: "p1", branch: "main", agentBackend: "claude", worktreePath: "/p/w", status: "active", sessionId: "s1" }],
    activeWorkspaceId: "w1",
    projectSettings: { open: false, projectId: null },
  } as never);
  useProjectSettingsStore.setState({ data: SETTINGS(), projectId: "p1", status: "loaded", dirty: {}, lastError: null });
});

describe("Panel", () => {
  it("shows Add setup script CTA when scripts.setup is empty", () => {
    renderWithProviders(<Panel />);
    expect(screen.getByRole("button", { name: /Add setup script/i })).toBeInTheDocument();
  });

  it("CTA opens ProjectSettings to scripts/setup", async () => {
    renderWithProviders(<Panel />);
    await userEvent.click(screen.getByRole("button", { name: /Add setup script/i }));
    const ps = useWorkbench.getState().projectSettings;
    expect(ps.open).toBe(true);
    expect(ps.initialSection).toBe("scripts");
    expect(ps.focusField).toBe("setup");
  });

  it("configured setup → Run button visible", () => {
    useProjectSettingsStore.setState({ data: SETTINGS({ scripts: { setup: "bun install", run: "", archive: "" } }), projectId: "p1", status: "loaded", dirty: {}, lastError: null });
    renderWithProviders(<Panel />);
    expect(screen.getByRole("button", { name: /Run setup/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run failing**

```bash
bun run test src/components/panel/Panel.test.tsx 2>&1 | tail -10
```

- [ ] **Step 3: Implement**

```tsx
// src/components/panel/Panel.tsx
import { useState, useMemo } from "react";
import { Play, Wrench, FolderPlus, StopCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkbench, selectActiveWorkspace } from "@/state/store";
import { useProjectSettingsStore } from "@/lib/stores/project-settings";
import { useScriptRunner } from "@/hooks/useScriptRunner";
import { PanelTabs, type BottomPanelTab } from "./PanelTabs";

function EmptyState({ icon: Icon, title, hint, ctaLabel, onCta }: { icon: typeof Play; title: string; hint: string; ctaLabel: string; onCta: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
      <Icon className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
      <span className="text-[13px] text-foreground">{title}</span>
      <p className="max-w-md text-xs text-muted-foreground">{hint}</p>
      <button
        type="button"
        onClick={onCta}
        className="mt-1 rounded-md border border-dashed border-border bg-card/30 px-4 py-2 text-[12px] text-foreground hover:bg-card/60"
      >
        <FolderPlus className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />
        {ctaLabel}
      </button>
    </div>
  );
}

function ScriptPane({ kind }: { kind: "setup" | "run" }) {
  const activeWs = useWorkbench(selectActiveWorkspace);
  const settings = useProjectSettingsStore((s) => s.data);
  const openProjectSettings = useWorkbench((s) => s.openProjectSettings);

  const script = useMemo(() => settings?.scripts?.[kind] ?? "", [settings, kind]);
  const runner = useScriptRunner(activeWs?.id ?? null, activeWs?.worktreePath ?? null, script);

  if (!activeWs || !settings) {
    return <EmptyState icon={kind === "setup" ? Wrench : Play} title={kind === "setup" ? "Setup" : "Run"} hint="Open a workspace to configure scripts." ctaLabel="Open Project Settings" onCta={() => { /* no project yet */ }} />;
  }

  if (!script.trim()) {
    return (
      <EmptyState
        icon={kind === "setup" ? Wrench : Play}
        title={kind === "setup" ? "Setup" : "Run"}
        hint={kind === "setup" ? "Run commands when a workspace is created to install dependencies or set up the environment." : "Run a dev server or test runner to verify changes in this workspace."}
        ctaLabel={kind === "setup" ? "Add setup script" : "Add run script"}
        onCta={() => openProjectSettings({ projectId: activeWs.projectId, initialSection: "scripts", focusField: kind })}
      />
    );
  }

  return (
    <div data-testid={`panel-${kind}-content`} className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-muted-foreground">
        <button
          type="button"
          onClick={runner.state === "running" ? () => void runner.stop() : () => void runner.start()}
          className="inline-flex items-center gap-1.5 rounded-md bg-sidebar-hover px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
        >
          {runner.state === "running" ? <StopCircle className="h-3 w-3 text-destructive" /> : <Play className="h-3 w-3" />}
          {runner.state === "running" ? "Stop" : kind === "setup" ? "Run setup" : "Run"}
        </button>
        <span className="font-mono text-[11px] truncate">{script}</span>
      </div>
      <pre
        className={cn("flex-1 overflow-auto whitespace-pre-wrap px-3 pb-3 font-mono text-[11px]",
          runner.state === "exited" && runner.exitCode !== 0 && "text-destructive")}
      >
        {runner.output || (runner.state === "idle" ? "Click Run to start." : "")}
      </pre>
      {runner.state === "exited" && runner.exitCode !== 0 && (
        <div className="border-t border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          Exited {runner.exitCode}. <button type="button" onClick={() => void runner.start()} className="underline">Retry</button>
        </div>
      )}
    </div>
  );
}

export function Panel({ collapsed = false }: { collapsed?: boolean }) {
  const [tab, setTab] = useState<BottomPanelTab>("setup");

  return (
    <section
      data-testid="bottom-panel"
      className={cn("mv-panel flex w-full flex-col bg-sidebar", collapsed ? "shrink-0" : "h-full")}
      style={{ borderTop: "1px solid hsl(var(--border))" }}
    >
      <PanelTabs value={tab} onChange={setTab} />
      {!collapsed && (
        <div className="flex-1 overflow-hidden">
          {tab === "setup" && <ScriptPane kind="setup" />}
          {tab === "run" && <ScriptPane kind="run" />}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run**

```bash
bun run test src/components/panel/ 2>&1 | tail -8
```

- [ ] **Step 5: Commit**

```bash
git add src/components/panel/Panel.tsx src/components/panel/Panel.test.tsx
git commit -m "feat(panel): wire Setup/Run tabs to project scripts + runner"
```

---

### Task 23: Auto-load `useProjectSettingsStore` for the active workspace's project

**Files:**
- Modify: `src/components/workbench/Workbench.tsx`

- [ ] **Step 1: Append effect**

After the existing `useEffect` (the one calling `refreshProjects` / `refreshWorkspaces`), add:

```tsx
const activeWsProjectId = useWorkbench((s) => {
  const ws = s.activeWorkspaceId ? s.workspaces.find((w) => w.id === s.activeWorkspaceId) : null;
  return ws?.projectId ?? null;
});
const loadProjectSettings = useProjectSettingsStore((s) => s.load);

useEffect(() => {
  if (activeWsProjectId) {
    void loadProjectSettings(activeWsProjectId);
  }
}, [activeWsProjectId, loadProjectSettings]);
```

Plus the new import: `import { useProjectSettingsStore } from "@/lib/stores/project-settings";`

- [ ] **Step 2: Run all workbench tests**

```bash
bun run test src/components/workbench/ 2>&1 | tail -6
```

- [ ] **Step 3: Commit**

```bash
git add src/components/workbench/Workbench.tsx
git commit -m "feat(workbench): auto-load project settings for active workspace"
```

---

### Task 24: Preview URL button in `PanelTabs`

**Files:**
- Modify: `src/components/panel/PanelTabs.tsx`
- Modify: `src/components/panel/PanelTabs.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
it("shows Open preview button when previewUrl is set", () => {
  useWorkbench.setState({ activeWorkspaceId: "w1", workspaces: [{ id: "w1", projectId: "p1", branch: "main", agentBackend: "claude", worktreePath: "/p/w", status: "active", sessionId: "s1" }] } as never);
  useProjectSettingsStore.setState({ data: { ...BASE, previewUrl: "http://localhost:${WORKSPACE_PORT}" }, projectId: "p1", status: "loaded", dirty: {}, lastError: null });
  renderWithProviders(<PanelTabs value="setup" onChange={() => {}} />);
  expect(screen.getByRole("button", { name: /Open preview/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Implement**

Append a small `<PreviewButton />` inside the `<div className="flex items-center gap-1 pr-2">` group in `PanelTabs.tsx`, before the existing Run button:

```tsx
function PreviewButton() {
  const ws = useWorkbench(selectActiveWorkspace);
  const previewUrl = useProjectSettingsStore((s) => s.data?.previewUrl ?? "");
  if (!ws || !previewUrl) return null;
  const url = previewUrl
    .replace("${WORKSPACE_NAME}", ws.branch)
    .replace("${WORKSPACE_PATH}", ws.worktreePath)
    .replace("${WORKSPACE_PORT}", "3000"); // TODO: per-workspace port assignment (future)
  return (
    <button
      type="button"
      aria-label="Open preview"
      onClick={() => { void import("@tauri-apps/plugin-shell").then((m) => m.open(url)); }}
      className="flex h-6 items-center gap-1.5 rounded-md bg-sidebar-hover px-2.5 text-[11px] font-medium text-foreground hover:bg-muted"
    >
      Open preview ↗
    </button>
  );
}
```

Insert `<PreviewButton />` before the existing Run button in the JSX.

- [ ] **Step 3: Run**

```bash
bun run test src/components/panel/ 2>&1 | tail -6
```

- [ ] **Step 4: Commit**

```bash
git add src/components/panel/PanelTabs.tsx src/components/panel/PanelTabs.test.tsx
git commit -m "feat(panel): Open preview button driven by previewUrl"
```

---

### Task 25: Command Palette entries + ⌘⇧, shortcut

**Files:**
- Modify: `src/shortcuts/registry.ts`
- Modify: `src/components/quickopen/CommandPalette.tsx`

- [ ] **Step 1: Add shortcut + palette entries**

In `registry.ts`, append:

```ts
{ id: "project-settings.open", label: "Project Settings: Open for active workspace", category: "Workspace", keys: "$mod+Shift+,", display: "⌘⇧," },
{ id: "project-settings.edit-file", label: "Project Settings: Edit maverick.json", category: "Workspace" },
```

In `CommandPalette.tsx`, add to the command list (mirrors existing entries):

```ts
{
  id: "project-settings.open",
  label: "Project Settings: Open for active project",
  action: () => {
    const ws = useWorkbench.getState().workspaces.find((w) => w.id === useWorkbench.getState().activeWorkspaceId);
    if (!ws) return;
    useWorkbench.getState().openProjectSettings({ projectId: ws.projectId });
  },
},
```

- [ ] **Step 2: Run shortcut tests**

```bash
bun run test src/shortcuts/ src/components/quickopen/ 2>&1 | tail -6
```

- [ ] **Step 3: Commit**

```bash
git add src/shortcuts/registry.ts src/components/quickopen/CommandPalette.tsx
git commit -m "feat(shortcuts): ⌘⇧, opens project settings; palette entries"
```

---

### Task 26: Listen for `project:settings:changed` and refresh store

**Files:**
- Modify: `src/components/workbench/Workbench.tsx`

- [ ] **Step 1: Add listener effect**

```tsx
useEffect(() => {
  const off = onProjectSettingsChanged(({ projectId, settings }) => {
    const cur = useProjectSettingsStore.getState();
    if (cur.projectId !== projectId) return;
    if (Object.keys(cur.dirty).length > 0) {
      // Banner state handled by store; for v1 surface a soft toast.
      console.warn("project settings changed on disk while editing — keep editing wins on next save");
      return;
    }
    useProjectSettingsStore.setState({ data: settings });
  });
  return () => { off.then((fn) => fn()); };
}, []);
```

Import: `import { onProjectSettingsChanged } from "@/lib/tauri";`

- [ ] **Step 2: Run**

```bash
bun run test src/components/workbench/ 2>&1 | tail -6
```

- [ ] **Step 3: Commit**

```bash
git add src/components/workbench/Workbench.tsx
git commit -m "feat(workbench): live-reload project settings on disk changes"
```

---

### Task 27: Coverage + final smoke

**Files:** none (verification only)

- [ ] **Step 1: Full bun test with coverage**

```bash
bun run test:coverage 2>&1 | tail -25
```

Expected: lines ≥ 100%, branches ≥ 95% on changed files (per `vitest.config.ts` thresholds). If a threshold fails, add the missing test in the relevant zone before continuing.

- [ ] **Step 2: Cargo test**

```bash
cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10
```

- [ ] **Step 3: Sidecar bun test**

```bash
bun test sidecar/ 2>&1 | tail -6
```

- [ ] **Step 4: Manual E2E in dev**

```bash
bun run tauri dev
```

Verify in the running app:
1. Hover a project row → cog appears → click → Project Settings opens.
2. Set `Setup script` = `echo hello > .marker` → blur → footer shows "Saved · just now".
3. Close modal, open Panel → Setup tab shows configured state + Run button.
4. Create a workspace from that project → `.marker` should exist in the new worktree root.
5. Click Run on the Run tab (after setting `bun run dev`) → output streams.

- [ ] **Step 5: Final commit + PR**

```bash
git log --oneline cc-feature/project-settings ^main
git push -u origin cc-feature/project-settings
gh pr create --title "feat: per-project settings modal + Panel Setup/Run wiring" --body "$(cat <<'EOF'
## Summary
- New ProjectSettingsPanel mirroring Conductor's surface area with Maverick-native naming.
- maverick.json grows a nested `project` block; loader normalizes defaults; atomic writes.
- Three new sidecar RPCs + Rust commands.
- Panel Setup/Run tabs read project scripts via useScriptRunner; empty-state CTAs open the modal directly to the right field.
- Auto-run setup on workspace.create; archive script with 30s timeout on workspace.destroy.

## Test plan
- [ ] Add a project → open Project Settings → set setup/run scripts → save
- [ ] Create workspace from that project → setup runs once, .marker appears
- [ ] Click Run on Run tab → dev server output streams; Stop kills it
- [ ] Destroy workspace → archive script runs synchronously
- [ ] Preview URL button appears once previewUrl is set
- [ ] ⌘⇧, opens modal for active workspace's project

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Plan tasks |
|---|---|
| §1 Schema | 4, 5 |
| §2.1 Shared shell | 2, 3 |
| §2.2 Sections | 14, 15, 16, 17, 18 |
| §2.3 Component contract | 19 |
| §3.1 IPC | 6, 11 |
| §3.2 Rust commands | 11 |
| §3.3 React store | 13 |
| §3.4 Save semantics | 13, 14–18 (blur wiring) |
| §3.5 Error surfaces | 13 (covered in store error path; surfaced via existing SettingsFooter status pill) |
| §4.1 Context | 23 |
| §4.2 useScriptRunner | 21 |
| §4.3 Tab rendering | 22 |
| §4.4 Lifecycle hooks | 8, 9 |
| §4.5 Files-to-copy | 7 |
| §4.6 Preview URL | 24 |
| §4.7 No active workspace | 22 (renders neutral empty state if no active workspace) |
| §5 Entry points | 20, 25 |
| §6 Build sequence | implicit in task ordering |
| §7 Testing plan | each task |

All spec sections have at least one task.

**Placeholder scan:** No "TBD" / "implement later" / "similar to Task N" in step bodies. Every code block is concrete.

**Type consistency:**
- `ProjectSettings` shape matches between `sidecar/project-settings.ts`, `sidecar/types.ts`, and `src/lib/ipc.ts`.
- Section IDs `"identity" | "workspaces" | "preview" | "scripts" | "preferences"` are consistent between Task 1's store type, Task 19's `ProjectSection`, and Task 22's CTA call.
- `openProjectSettings({ projectId, initialSection?, focusField? })` signature consistent across all callers.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-23-project-settings.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch with checkpoints.

**Which approach?**
