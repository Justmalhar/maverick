# Viewer Registry, Editor File Tabs & Diff Viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a file opens a real editor tab (Monaco) in the EditorArea with VSCode preview-tab semantics; clicking a changed file opens a Monaco diff tab with a Conductor-style toolbar; an OOP viewer registry dispatches markdown/image/video/pdf/csv/hex viewers.

**Architecture:** A `ViewerRegistry` (mirroring `TerminalRegistry` — nothing outside `src/lib/viewers/**` + `src/components/viewers/**` imports Monaco/pdfjs/SheetJS) resolves a lazy viewer component from `(FileMeta, ViewerIntent)`. A new `FileTab` family in the zustand store drives `EditorTabs`/`EditorGroup`. Three new IPC commands (`file_write`, `file_read_at_ref`, `git_discard_file`) flow React → Rust passthrough → Bun sidecar. Tier-1 VSCode compat = Shiki TextMate grammars/themes injected into Monaco.

**Tech Stack:** monaco-editor (slim `editor.api` core), shiki + @shikijs/monaco, papaparse, xlsx (lazy), existing react-markdown/pdfjs-dist/react-window. Branch: work directly on `main`.

**Spec:** `docs/superpowers/specs/2026-06-13-viewer-registry-design.md`

---

## Dependency graph / subagent zones

| Workstream | Tasks | Zone | Depends on |
|---|---|---|---|
| A — IPC foundations | A1–A5 | `sidecar/**`, `src-tauri/**`, `src/lib/ipc.ts`+`src/lib/tauri.ts` | — |
| B — Tab model & shell | B1–B4 | `src/state/**`, `src/components/editor/**`, `src/components/auxiliarybar/**`, `src/components/quickopen/**` | — |
| C — Monaco infra | C1–C3 | `src/lib/viewers/monaco/**`, `src/test/setup.ts`, `package.json` | — |
| D — Registry & simple viewers | D1–D4 | `src/lib/viewers/**`, `src/components/viewers/**` | B |
| E — Code & Diff viewers | E1–E3 | `src/lib/viewers/**`, `src/components/viewers/**`, SCM click wiring | A, B, C, D |
| F — Grid viewer | F1 | `src/lib/viewers/**`, `src/components/viewers/**` | D |
| G — Final verification | G1 | all | A–F |

A, B, C can run in parallel (disjoint files). Run `bun run test` / `bun run test:sidecar` / `cargo check` per the task instructions; commit after every task.

Conventions reminders (CLAUDE.md): bun not npm; tokens-only Tailwind classes; tests query by role first; no `any`; every public function tested; lazy-load heavy deps; `.mv-<component>` CSS class names.

---

# Workstream A — IPC foundations

## Task A1: Sidecar `FileWriter` (atomic write + mtime conflict) and `mtime` on reads

**Files:**
- Create: `sidecar/file-writer.ts`
- Create: `sidecar/file-writer.test.ts`
- Modify: `sidecar/file-reader.ts` (add `mtime` to `ReadResult`)
- Modify: `sidecar/file-reader.test.ts` (assert `mtime`)

- [ ] **Step 1: Write failing tests**

`sidecar/file-writer.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { FileWriter, FileWriteConflictError } from "./file-writer";

function tmpFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mv-fw-"));
  const p = join(dir, "a.txt");
  writeFileSync(p, content);
  return p;
}

describe("FileWriter", () => {
  test("writes content and returns the new mtime", () => {
    const p = tmpFile("old");
    const w = new FileWriter();
    const res = w.write({ filePath: p, content: "new" });
    expect(readFileSync(p, "utf8")).toBe("new");
    expect(res.mtime).toBe(statSync(p).mtimeMs);
  });

  test("creates a new file when the path does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "mv-fw-"));
    const p = join(dir, "fresh.txt");
    const w = new FileWriter();
    const res = w.write({ filePath: p, content: "hello" });
    expect(readFileSync(p, "utf8")).toBe("hello");
    expect(res.mtime).toBeGreaterThan(0);
  });

  test("matching expectedMtime writes", () => {
    const p = tmpFile("old");
    const onDisk = statSync(p).mtimeMs;
    const w = new FileWriter();
    const res = w.write({ filePath: p, content: "new", expectedMtime: onDisk });
    expect(readFileSync(p, "utf8")).toBe("new");
    expect(res.mtime).toBeGreaterThanOrEqual(onDisk);
  });

  test("stale expectedMtime throws FileWriteConflictError and leaves file intact", () => {
    const p = tmpFile("old");
    const w = new FileWriter();
    expect(() => w.write({ filePath: p, content: "new", expectedMtime: 12345 })).toThrow(
      FileWriteConflictError
    );
    expect(readFileSync(p, "utf8")).toBe("old");
  });

  test("atomic: no temp file left behind after write", () => {
    const p = tmpFile("old");
    const w = new FileWriter();
    w.write({ filePath: p, content: "new" });
    const { readdirSync } = require("fs") as typeof import("fs");
    const dir = p.slice(0, p.lastIndexOf("/"));
    expect(readdirSync(dir)).toEqual(["a.txt"]);
  });
});
```

In `sidecar/file-reader.test.ts`, add inside the existing `describe`:

```ts
  test("read returns the file mtime", () => {
    // Reuse the suite's existing fixture pattern for a readable file and assert:
    // expect(result.mtime).toBeGreaterThan(0) on a successful read and
    // expect(result.mtime).toBe(0) on the unreadable path branch.
  });
```

(Write it concretely against the suite's existing fixtures — the file already constructs `FileReader` with injected `readFile`/`stat`; extend the injected `stat` mock to return `{ size, mtimeMs }`.)

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && bun test file-writer.test.ts file-reader.test.ts`
Expected: FAIL — `file-writer` module not found; mtime assertions fail.

- [ ] **Step 3: Implement**

`sidecar/file-writer.ts`:

```ts
import { mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";

export interface FileWriteResult {
  /** mtimeMs of the file after the write — clients echo this back as expectedMtime. */
  mtime: number;
}

/** Thrown when the on-disk mtime no longer matches what the client last saw. */
export class FileWriteConflictError extends Error {
  readonly code = "conflict";
  constructor(filePath: string) {
    super(`file changed on disk since last read: ${filePath}`);
    this.name = "FileWriteConflictError";
  }
}

export interface FileWriterOptions {
  stat?: (path: string) => { mtimeMs: number };
}

export class FileWriter {
  private stat: (path: string) => { mtimeMs: number };

  constructor(opts: FileWriterOptions = {}) {
    this.stat = opts.stat ?? ((p) => statSync(p));
  }

  /**
   * Atomic write: temp file in the same directory + rename, so a crash never
   * leaves a half-written file. `expectedMtime` guards against clobbering an
   * external edit the client has not seen yet.
   */
  write(params: { filePath: string; content: string; expectedMtime?: number }): FileWriteResult {
    if (params.expectedMtime !== undefined) {
      let onDisk: number | null = null;
      try {
        onDisk = this.stat(params.filePath).mtimeMs;
      } catch {
        onDisk = null; // file deleted externally — allow the write to recreate it
      }
      if (onDisk !== null && onDisk !== params.expectedMtime) {
        throw new FileWriteConflictError(params.filePath);
      }
    }
    const dir = dirname(params.filePath);
    const tmpDir = mkdtempSync(join(dir, ".mv-write-"));
    const tmp = join(tmpDir, "tmp");
    try {
      writeFileSync(tmp, params.content, "utf8");
      renameSync(tmp, params.filePath);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    return { mtime: this.stat(params.filePath).mtimeMs };
  }
}
```

In `sidecar/file-reader.ts`: add `mtime: number;` to `ReadResult` (doc: "mtimeMs at read time; 0 when unreadable"), change the injected `stat` type to `(path: string) => { size: number; mtimeMs: number }` with default `(p) => statSync(p)`, capture it in `read()` and include `mtime` in all four return branches (0 for the unreadable branch, the real value otherwise).

- [ ] **Step 4: Run to verify pass**

Run: `cd sidecar && bun test file-writer.test.ts file-reader.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sidecar/file-writer.ts sidecar/file-writer.test.ts sidecar/file-reader.ts sidecar/file-reader.test.ts
git commit -m "feat(sidecar): FileWriter with atomic writes + mtime conflict detection"
```

## Task A2: `GitModule.showAtRef` and `GitModule.discardFile`

**Files:**
- Modify: `sidecar/git-module.ts`
- Modify: `sidecar/git-module.test.ts`

- [ ] **Step 1: Write failing tests**

The existing suite injects a fake `Shell`. Follow its pattern (look at the `commit`/`checkout` tests for the fake-shell shape) and add:

```ts
describe("showAtRef", () => {
  test("returns content from git show REF:path", async () => {
    const calls: string[][] = [];
    const shell = {
      run: async (cmd: string[]) => {
        calls.push(cmd);
        return { exitCode: 0, stdout: "old contents\n", stderr: "" };
      },
      text: async () => "",
    };
    const git = new GitModule({ shell: shell as never });
    const res = await git.showAtRef({ worktreePath: "/wt", filePath: "src/a.ts", ref: "HEAD" });
    expect(res).toEqual({ content: "old contents\n", missing: false });
    expect(calls[0]).toEqual(["git", "-C", "/wt", "show", "HEAD:src/a.ts"]);
  });

  test("missing at ref (added file) returns missing:true, not a throw", async () => {
    const shell = {
      run: async () => ({ exitCode: 128, stdout: "", stderr: "fatal: path 'src/a.ts' does not exist in 'HEAD'" }),
      text: async () => "",
    };
    const git = new GitModule({ shell: shell as never });
    const res = await git.showAtRef({ worktreePath: "/wt", filePath: "src/a.ts", ref: "HEAD" });
    expect(res).toEqual({ content: "", missing: true });
  });
});

describe("discardFile", () => {
  test("tracked file: git checkout HEAD -- path", async () => {
    const calls: string[][] = [];
    const shell = {
      run: async (cmd: string[]) => {
        calls.push(cmd);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
      text: async () => "",
    };
    const git = new GitModule({ shell: shell as never });
    const res = await git.discardFile({ worktreePath: "/wt", filePath: "src/a.ts" });
    expect(res).toEqual({ ok: true });
    expect(calls[0]).toEqual(["git", "-C", "/wt", "ls-files", "--error-unmatch", "--", "src/a.ts"]);
    expect(calls[1]).toEqual(["git", "-C", "/wt", "checkout", "HEAD", "--", "src/a.ts"]);
  });

  test("untracked file: removed via injected removeFile, no checkout", async () => {
    const calls: string[][] = [];
    const removed: string[] = [];
    const shell = {
      run: async (cmd: string[]) => {
        calls.push(cmd);
        return { exitCode: 1, stdout: "", stderr: "error: pathspec" };
      },
      text: async () => "",
    };
    const git = new GitModule({
      shell: shell as never,
      removeFile: async (p: string) => { removed.push(p); },
    });
    const res = await git.discardFile({ worktreePath: "/wt", filePath: "new.txt" });
    expect(res).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(removed).toEqual(["/wt/new.txt"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && bun test git-module.test.ts`
Expected: FAIL — `showAtRef`/`discardFile` are not functions.

- [ ] **Step 3: Implement in `sidecar/git-module.ts`**

Extend `GitModuleOptions` and the constructor:

```ts
export interface GitModuleOptions {
  shell?: Shell;
  readFile?: FileReader;
  removeFile?: (path: string) => Promise<void>;
}
```

Constructor default: `this.removeFile = opts.removeFile ?? ((p) => unlink(p));` with `import { unlink } from "fs/promises";` at the top. Add methods (near `blame`):

```ts
  /** File content at a ref (`git show REF:path`); `missing` when the path did not exist there. */
  async showAtRef(params: { worktreePath: string; filePath: string; ref: string }): Promise<{ content: string; missing: boolean }> {
    const { exitCode, stdout, stderr } = await this.shell.run(
      ["git", "-C", params.worktreePath, "show", `${params.ref}:${params.filePath}`],
      undefined
    );
    if (exitCode === 0) return { content: stdout, missing: false };
    if (/does not exist|exists on disk, but not in/i.test(stderr)) return { content: "", missing: true };
    throw new Error(stderr || "git show failed");
  }

  /** Undo working-tree changes: restore tracked files from HEAD, delete untracked ones. */
  async discardFile(params: { worktreePath: string; filePath: string }): Promise<{ ok: true }> {
    const tracked = await this.shell.run(
      ["git", "-C", params.worktreePath, "ls-files", "--error-unmatch", "--", params.filePath],
      undefined
    );
    if (tracked.exitCode === 0) {
      const { exitCode, stderr } = await this.shell.run(
        ["git", "-C", params.worktreePath, "checkout", "HEAD", "--", params.filePath],
        undefined
      );
      if (exitCode !== 0) throw new Error(stderr || "git checkout (discard) failed");
    } else {
      await this.removeFile(join(params.worktreePath, params.filePath));
    }
    return { ok: true };
  }
```

(`join` is already imported. Declare `private removeFile: (path: string) => Promise<void>;` alongside the other fields.)

- [ ] **Step 4: Run to verify pass**

Run: `cd sidecar && bun test git-module.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sidecar/git-module.ts sidecar/git-module.test.ts
git commit -m "feat(sidecar): git showAtRef + discardFile for diff viewer"
```

## Task A3: RPC wiring — schemas, handler cases, sidecar types

**Files:**
- Modify: `sidecar/rpc-handlers.ts`
- Modify: `sidecar/rpc-handlers.test.ts`
- Modify: `sidecar/types.ts`

- [ ] **Step 1: Write failing tests**

In `sidecar/rpc-handlers.test.ts`, follow the existing `file.read` test's construction style (injected fakes via the options object):

```ts
describe("file.write / file.readAtRef / git.discard_file", () => {
  test("file.write delegates to FileWriter", async () => {
    const written: unknown[] = [];
    const fileWriter = { write: (p: unknown) => { written.push(p); return { mtime: 42 }; } };
    const handlers = new RpcHandlers({ store, fileWriter: fileWriter as never, notifier: { write: () => {} } });
    const res = await handlers.handle("file.write", { filePath: "/a.txt", content: "x", expectedMtime: 7 });
    expect(res).toEqual({ mtime: 42 });
    expect(written[0]).toEqual({ filePath: "/a.txt", content: "x", expectedMtime: 7 });
  });

  test("file.readAtRef delegates to GitModule.showAtRef", async () => {
    const git = { showAtRef: async () => ({ content: "c", missing: false }) };
    const handlers = new RpcHandlers({ store, git: git as never, notifier: { write: () => {} } });
    const res = await handlers.handle("file.readAtRef", { worktreePath: "/wt", filePath: "a.ts", ref: "HEAD" });
    expect(res).toEqual({ content: "c", missing: false });
  });

  test("git.discard_file delegates to GitModule.discardFile", async () => {
    const git = { discardFile: async () => ({ ok: true }) };
    const handlers = new RpcHandlers({ store, git: git as never, notifier: { write: () => {} } });
    const res = await handlers.handle("git.discard_file", { worktreePath: "/wt", filePath: "a.ts" });
    expect(res).toEqual({ ok: true });
  });
});
```

(`store` = whatever in-memory `SQLiteStore` fixture the suite already builds; reuse it.)

- [ ] **Step 2: Run to verify failure**

Run: `cd sidecar && bun test rpc-handlers.test.ts`
Expected: FAIL — unknown method / unknown option `fileWriter`.

- [ ] **Step 3: Implement**

In `sidecar/rpc-handlers.ts`:

1. `import { FileWriter } from "./file-writer";`
2. Schemas (next to `fileRead`):

```ts
  fileWrite: z.object({
    filePath: z.string(),
    content: z.string(),
    expectedMtime: nullishOptional(z.number()),
  }),
  fileReadAtRef: z.object({ worktreePath: z.string(), filePath: z.string(), ref: z.string() }),
  gitDiscardFile: z.object({ worktreePath: z.string(), filePath: z.string() }),
```

3. Options + field + constructor default (same pattern as `fileReader`): `fileWriter?: FileWriter;` / `readonly fileWriter: FileWriter;` / `this.fileWriter = opts.fileWriter ?? new FileWriter();`
4. Dispatch cases (next to `case "file.read"` and `case "git.checkout"`):

```ts
      case "file.write": {
        const p = Schemas.fileWrite.parse(params);
        return this.fileWriter.write({ filePath: p.filePath, content: p.content, expectedMtime: p.expectedMtime });
      }
      case "file.readAtRef": {
        const p = Schemas.fileReadAtRef.parse(params);
        return this.git.showAtRef(p);
      }
      case "git.discard_file": {
        const p = Schemas.gitDiscardFile.parse(params);
        return this.git.discardFile(p);
      }
```

5. In `sidecar/types.ts`, next to `DiffHunk`:

```ts
export interface FileWriteResult {
  mtime: number;
}

export interface FileAtRefResult {
  content: string;
  missing: boolean;
}
```

- [ ] **Step 4: Run all sidecar tests**

Run: `cd sidecar && bun test`
Expected: PASS (full suite — catches accidental regressions in handler construction).

- [ ] **Step 5: Commit**

```bash
git add sidecar/rpc-handlers.ts sidecar/rpc-handlers.test.ts sidecar/types.ts
git commit -m "feat(sidecar): file.write / file.readAtRef / git.discard_file RPC methods"
```

## Task A4: Rust passthrough commands

**Files:**
- Modify: `src-tauri/src/commands/file_tree.rs` (add `file_write`)
- Modify: `src-tauri/src/commands/git.rs` (add `file_read_at_ref`, `git_discard_file`)
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the commands**

In `src-tauri/src/commands/file_tree.rs`, after `file_read`:

```rust
#[tauri::command]
pub async fn file_write(
    state: State<'_, AppState>,
    file_path: String,
    content: String,
    expected_mtime: Option<f64>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "file.write",
            json!({ "filePath": file_path, "content": content, "expectedMtime": expected_mtime }),
        )
        .await
        .map_err(|e| e.to_string())
}
```

In `src-tauri/src/commands/git.rs`, after `git_checkout`:

```rust
#[tauri::command]
pub async fn file_read_at_ref(
    state: State<'_, AppState>,
    worktree_path: String,
    file_path: String,
    r#ref: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "file.readAtRef",
            json!({ "worktreePath": worktree_path, "filePath": file_path, "ref": r#ref }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_discard_file(
    state: State<'_, AppState>,
    worktree_path: String,
    file_path: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "git.discard_file",
            json!({ "worktreePath": worktree_path, "filePath": file_path }),
        )
        .await
        .map_err(|e| e.to_string())
}
```

In `src-tauri/src/commands/mod.rs`: add `file_write` to the `pub use file_tree::{...}` list and `file_read_at_ref, git_discard_file` to the `pub use git::{...}` list (keep alphabetical order within each list).

In `src-tauri/src/lib.rs`: add `file_write,` after `file_read,` (line ~185) and `file_read_at_ref,` + `git_discard_file,` into the `generate_handler![]` list near the other git commands.

- [ ] **Step 2: Verify compile + tests**

Run: `cd src-tauri && cargo check && cargo test`
Expected: clean check, existing tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/file_tree.rs src-tauri/src/commands/git.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(rust): passthrough commands file_write, file_read_at_ref, git_discard_file"
```

## Task A5: Frontend IPC types + wrappers

**Files:**
- Modify: `src/lib/ipc.ts`
- Modify: `src/lib/tauri.ts`
- Test: `src/lib/tauri.test.ts` (extend if it exists; otherwise covered by callers' tests — check first with `ls src/lib/tauri.test.ts`)

- [ ] **Step 1: Add types to `src/lib/ipc.ts`**

Extend `FileReadResult` (line ~324) with `mtime: number;` (doc comment: "mtimeMs at read time; echo back to file_write as expectedMtime"). Next to it add:

```ts
export interface FileWriteResult {
  mtime: number;
}

export interface FileAtRefResult {
  content: string;
  missing: boolean;
}
```

- [ ] **Step 2: Add wrappers to `src/lib/tauri.ts`** (after `fileRead`, matching its style; add `FileAtRefResult, FileWriteResult` to the type import block):

```ts
export async function fileWrite(
  filePath: string,
  content: string,
  expectedMtime?: number
): Promise<FileWriteResult> {
  return invoke("file_write", { filePath, content, expectedMtime });
}

export async function fileReadAtRef(
  worktreePath: string,
  filePath: string,
  ref: string
): Promise<FileAtRefResult> {
  return invoke("file_read_at_ref", { worktreePath, filePath, ref });
}

export async function gitDiscardFile(
  worktreePath: string,
  filePath: string
): Promise<{ ok: true }> {
  return invoke("git_discard_file", { worktreePath, filePath });
}
```

- [ ] **Step 3: Verify**

Run: `bun run typecheck && bun run test`
Expected: PASS (no behavior change yet; `mtime` addition must not break existing mocks — if a test stubs `fileRead` results, add `mtime: 0` there).

- [ ] **Step 4: Commit**

```bash
git add src/lib/ipc.ts src/lib/tauri.ts
git commit -m "feat(ipc): fileWrite/fileReadAtRef/gitDiscardFile wrappers + FileReadResult.mtime"
```

---

# Workstream B — FileTab model & shell integration

## Task B1: `FileTab` store slice with VSCode preview-tab semantics

**Files:**
- Modify: `src/state/store.ts`
- Test: `src/state/store.filetabs.test.ts` (create)

- [ ] **Step 1: Write failing tests** — `src/state/store.filetabs.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useWorkbench, fileTabId } from "./store";

function open(input: Partial<Parameters<ReturnType<typeof useWorkbench.getState>["openFileTab"]>[0]> = {}) {
  useWorkbench.getState().openFileTab({
    kind: "file",
    path: "/wt/src/a.ts",
    worktreePath: "/wt",
    preview: true,
    ...input,
  });
}

describe("FileTab store", () => {
  beforeEach(() => {
    useWorkbench.setState({
      fileTabs: [],
      activeFileTabId: null,
      activeWorkspaceId: null,
      activeSystemTab: null,
      activeTerminalTabId: null,
    });
  });

  it("fileTabId is stable per kind+path", () => {
    expect(fileTabId("file", "/wt/a.ts")).toBe("file:/wt/a.ts");
    expect(fileTabId("diff", "/wt/a.ts")).not.toBe(fileTabId("file", "/wt/a.ts"));
  });

  it("openFileTab adds a preview tab and activates it", () => {
    open();
    const s = useWorkbench.getState();
    expect(s.fileTabs).toHaveLength(1);
    expect(s.fileTabs[0]).toMatchObject({
      kind: "file", path: "/wt/src/a.ts", preview: true, dirty: false, mode: "edit",
    });
    expect(s.activeFileTabId).toBe(s.fileTabs[0].id);
    expect(s.activeWorkspaceId).toBeNull();
  });

  it("a second preview open REPLACES the existing preview tab in place", () => {
    open();
    open({ path: "/wt/src/b.ts" });
    const s = useWorkbench.getState();
    expect(s.fileTabs).toHaveLength(1);
    expect(s.fileTabs[0].path).toBe("/wt/src/b.ts");
  });

  it("pinned tabs are never replaced by preview opens", () => {
    open({ preview: false });
    open({ path: "/wt/src/b.ts" });
    const s = useWorkbench.getState();
    expect(s.fileTabs).toHaveLength(2);
  });

  it("re-opening the same path with preview:false pins the existing tab", () => {
    open();
    open({ preview: false });
    const s = useWorkbench.getState();
    expect(s.fileTabs).toHaveLength(1);
    expect(s.fileTabs[0].preview).toBe(false);
  });

  it("marking dirty pins the tab", () => {
    open();
    useWorkbench.getState().setFileTabDirty(useWorkbench.getState().fileTabs[0].id, true);
    const tab = useWorkbench.getState().fileTabs[0];
    expect(tab.dirty).toBe(true);
    expect(tab.preview).toBe(false);
  });

  it("closeFileTab removes a clean tab and returns true", () => {
    open();
    const id = useWorkbench.getState().fileTabs[0].id;
    expect(useWorkbench.getState().closeFileTab(id)).toBe(true);
    expect(useWorkbench.getState().fileTabs).toHaveLength(0);
    expect(useWorkbench.getState().activeFileTabId).toBeNull();
  });

  it("closeFileTab blocks a dirty tab unless forced", () => {
    open();
    const id = useWorkbench.getState().fileTabs[0].id;
    useWorkbench.getState().setFileTabDirty(id, true);
    expect(useWorkbench.getState().closeFileTab(id)).toBe(false);
    expect(useWorkbench.getState().fileTabs).toHaveLength(1);
    expect(useWorkbench.getState().closeFileTab(id, { force: true })).toBe(true);
    expect(useWorkbench.getState().fileTabs).toHaveLength(0);
  });

  it("setFileTabMode and setFileTabViewer update the tab", () => {
    open({ kind: "diff", mode: "diff" });
    const id = useWorkbench.getState().fileTabs[0].id;
    useWorkbench.getState().setFileTabMode(id, "edit");
    useWorkbench.getState().setFileTabViewer(id, "hex");
    expect(useWorkbench.getState().fileTabs[0]).toMatchObject({ mode: "edit", viewerId: "hex" });
  });

  it("activating a workspace clears the active file tab and vice versa", () => {
    open();
    useWorkbench.getState().setActiveWorkspace("ws-1");
    expect(useWorkbench.getState().activeFileTabId).toBeNull();
    useWorkbench.getState().setActiveFileTab(useWorkbench.getState().fileTabs[0].id);
    expect(useWorkbench.getState().activeWorkspaceId).toBeNull();
  });

  it("opening a system tab clears the active file tab", () => {
    open();
    useWorkbench.getState().openSystemTab("kanban");
    expect(useWorkbench.getState().activeFileTabId).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test src/state/store.filetabs.test.ts`
Expected: FAIL — `openFileTab` undefined.

- [ ] **Step 3: Implement in `src/state/store.ts`**

Types (after `TerminalTab`):

```ts
export type FileTabKind = "file" | "diff";
export type FileTabMode = "view" | "edit" | "diff";

export interface FileTab {
  id: string;
  kind: FileTabKind;
  /** Absolute path of the file. */
  path: string;
  /** Worktree root — diff context and breadcrumb base. */
  worktreePath: string;
  /** "Open With…" override; undefined = registry default. */
  viewerId?: string;
  /** Italic preview tab — reused by the next single-click open. */
  preview: boolean;
  dirty: boolean;
  mode: FileTabMode;
  /** Diff-tab "viewed" checkbox state. */
  viewed: boolean;
}

export interface OpenFileTabInput {
  kind: FileTabKind;
  path: string;
  worktreePath: string;
  preview: boolean;
  mode?: FileTabMode;
  viewerId?: string;
}

export const fileTabId = (kind: FileTabKind, path: string): string => `${kind}:${path}`;
```

State fields: `fileTabs: FileTab[];` and `activeFileTabId: string | null;` — initial `[]` / `null`. Mutator signatures in `WorkbenchState`:

```ts
  openFileTab: (input: OpenFileTabInput) => void;
  setActiveFileTab: (id: string | null) => void;
  /** Returns false when blocked by a dirty tab (caller shows confirm UI). */
  closeFileTab: (id: string, opts?: { force?: boolean }) => boolean;
  pinFileTab: (id: string) => void;
  setFileTabDirty: (id: string, dirty: boolean) => void;
  setFileTabMode: (id: string, mode: FileTabMode) => void;
  setFileTabViewer: (id: string, viewerId: string) => void;
  setFileTabViewed: (id: string, viewed: boolean) => void;
```

Implementations (inside the `create()` object). Note `closeFileTab` must use `useWorkbench.getState()`-free logic — implement with a mutable result captured around `set`:

```ts
    fileTabs: [],
    activeFileTabId: null,

    openFileTab: (input) =>
      set((s) => {
        const id = fileTabId(input.kind, input.path);
        const defaultMode: FileTabMode = input.mode ?? (input.kind === "diff" ? "diff" : "edit");
        const existing = s.fileTabs.find((t) => t.id === id);
        if (existing) {
          return {
            fileTabs: s.fileTabs.map((t) =>
              t.id === id ? { ...t, preview: t.preview && input.preview } : t
            ),
            activeFileTabId: id,
            activeWorkspaceId: null,
            activeSystemTab: null,
            activeTerminalTabId: null,
          };
        }
        const tab: FileTab = {
          id,
          kind: input.kind,
          path: input.path,
          worktreePath: input.worktreePath,
          viewerId: input.viewerId,
          preview: input.preview,
          dirty: false,
          mode: defaultMode,
          viewed: false,
        };
        // VSCode preview semantics: at most one preview tab; a new preview
        // open replaces it in place instead of appending.
        const previewIdx = input.preview ? s.fileTabs.findIndex((t) => t.preview) : -1;
        const fileTabs =
          previewIdx >= 0
            ? s.fileTabs.map((t, i) => (i === previewIdx ? tab : t))
            : [...s.fileTabs, tab];
        return {
          fileTabs,
          activeFileTabId: id,
          activeWorkspaceId: null,
          activeSystemTab: null,
          activeTerminalTabId: null,
        };
      }),

    setActiveFileTab: (id) =>
      set((s) => ({
        activeFileTabId: id,
        activeWorkspaceId: id ? null : s.activeWorkspaceId,
        activeSystemTab: id ? null : s.activeSystemTab,
        activeTerminalTabId: id ? null : s.activeTerminalTabId,
      })),

    closeFileTab: (id, opts) => {
      const tab = useWorkbench.getState().fileTabs.find((t) => t.id === id);
      if (!tab) return true;
      if (tab.dirty && !opts?.force) return false;
      set((s) => ({
        fileTabs: s.fileTabs.filter((t) => t.id !== id),
        activeFileTabId: s.activeFileTabId === id ? null : s.activeFileTabId,
      }));
      return true;
    },

    pinFileTab: (id) =>
      set((s) => ({
        fileTabs: s.fileTabs.map((t) => (t.id === id ? { ...t, preview: false } : t)),
      })),

    setFileTabDirty: (id, dirty) =>
      set((s) => ({
        fileTabs: s.fileTabs.map((t) =>
          t.id === id ? { ...t, dirty, preview: dirty ? false : t.preview } : t
        ),
      })),

    setFileTabMode: (id, mode) =>
      set((s) => ({
        fileTabs: s.fileTabs.map((t) => (t.id === id ? { ...t, mode } : t)),
      })),

    setFileTabViewer: (id, viewerId) =>
      set((s) => ({
        fileTabs: s.fileTabs.map((t) => (t.id === id ? { ...t, viewerId } : t)),
      })),

    setFileTabViewed: (id, viewed) =>
      set((s) => ({
        fileTabs: s.fileTabs.map((t) => (t.id === id ? { ...t, viewed } : t)),
      })),
```

Cross-family exclusivity — update the EXISTING mutators to also clear `activeFileTabId`:
- `setActiveWorkspace`: add `activeFileTabId: id ? null : s.activeFileTabId,`
- `openSystemTab`: add `activeFileTabId: null,`
- `setActiveSystemTab`: add `activeFileTabId: id ? null : s.activeFileTabId,`
- `setActiveTerminalTab`: add `activeFileTabId: null,`

Note on `closeFileTab`: the zustand `create` callback also receives `get` as its second argument — prefer `(set, get)` and `get().fileTabs` over `useWorkbench.getState()` inside the store definition.

- [ ] **Step 4: Run to verify pass**

Run: `bun run test src/state/`
Expected: PASS, including pre-existing store tests.

- [ ] **Step 5: Commit**

```bash
git add src/state/store.ts src/state/store.filetabs.test.ts
git commit -m "feat(store): FileTab slice with VSCode preview-tab semantics"
```

## Task B2: File tabs in `EditorTabs` (italic preview, dirty dot, confirm-close)

**Files:**
- Create: `src/components/editor/FileEditorTab.tsx`
- Modify: `src/components/editor/EditorTabs.tsx`
- Test: `src/components/editor/FileEditorTab.test.tsx` (create)
- Modify: `src/components/editor/EditorTabs.test.tsx` (add file-tab cases)

- [ ] **Step 1: Write failing tests** — `src/components/editor/FileEditorTab.test.tsx`:

```tsx
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useWorkbench } from "@/state/store";
import { EditorTabs } from "./EditorTabs";

function openTab(path = "/wt/src/a.ts", overrides: Record<string, unknown> = {}) {
  useWorkbench.getState().openFileTab({
    kind: "file",
    path,
    worktreePath: "/wt",
    preview: true,
    ...(overrides as object),
  });
}

describe("file tabs in EditorTabs", () => {
  beforeEach(() => {
    useWorkbench.setState({ fileTabs: [], activeFileTabId: null, workspaces: [], systemTabs: [], terminalTabs: [] });
  });

  it("renders the basename, italic while preview", () => {
    openTab();
    render(<EditorTabs />);
    const tab = screen.getByTestId("editor-tab-file-file:/wt/src/a.ts");
    expect(tab).toHaveTextContent("a.ts");
    expect(tab.querySelector(".italic")).not.toBeNull();
  });

  it("not italic once pinned", () => {
    openTab();
    useWorkbench.getState().pinFileTab("file:/wt/src/a.ts");
    render(<EditorTabs />);
    expect(
      screen.getByTestId("editor-tab-file-file:/wt/src/a.ts").querySelector(".italic")
    ).toBeNull();
  });

  it("double-click pins the preview tab", () => {
    openTab();
    render(<EditorTabs />);
    fireEvent.doubleClick(screen.getByTestId("editor-tab-file-file:/wt/src/a.ts"));
    expect(useWorkbench.getState().fileTabs[0].preview).toBe(false);
  });

  it("shows a dirty dot instead of the close icon when dirty", () => {
    openTab();
    useWorkbench.getState().setFileTabDirty("file:/wt/src/a.ts", true);
    render(<EditorTabs />);
    expect(screen.getByTestId("file-tab-dirty-file:/wt/src/a.ts")).toBeInTheDocument();
  });

  it("close button closes a clean tab", () => {
    openTab();
    render(<EditorTabs />);
    fireEvent.click(screen.getByRole("button", { name: "Close a.ts" }));
    expect(useWorkbench.getState().fileTabs).toHaveLength(0);
  });

  it("closing a dirty tab opens a confirm dialog; confirming force-closes", async () => {
    openTab();
    useWorkbench.getState().setFileTabDirty("file:/wt/src/a.ts", true);
    render(<EditorTabs />);
    fireEvent.click(screen.getByRole("button", { name: "Close a.ts" }));
    expect(useWorkbench.getState().fileTabs).toHaveLength(1);
    fireEvent.click(await screen.findByRole("button", { name: /close without saving/i }));
    expect(useWorkbench.getState().fileTabs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test src/components/editor/FileEditorTab.test.tsx`
Expected: FAIL — testid not found.

- [ ] **Step 3: Implement**

`src/components/editor/FileEditorTab.tsx`:

```tsx
import { FileText, GitCompareArrows, X } from "lucide-react";
import type { FileTab } from "@/state/store";
import { cn } from "@/lib/utils";

interface Props {
  tab: FileTab;
  active: boolean;
  onSelect: () => void;
  onPin: () => void;
  onClose: () => void;
}

export function FileEditorTab({ tab, active, onSelect, onPin, onClose }: Props) {
  const name = tab.path.split("/").pop() ?? tab.path;
  const Icon = tab.kind === "diff" ? GitCompareArrows : FileText;
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onPin}
      data-testid={`editor-tab-file-${tab.id}`}
      className={cn(
        "group relative flex min-w-[110px] items-center gap-1.5 px-3 text-[12px] transition-colors duration-100",
        active
          ? "bg-tab-active text-tab-fg-active"
          : "bg-tab-inactive text-tab-fg hover:bg-foreground/5 hover:text-foreground"
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
      <span className={cn("flex-1 truncate text-left", tab.preview && "italic")}>{name}</span>
      {tab.dirty ? (
        <span
          data-testid={`file-tab-dirty-${tab.id}`}
          aria-label={`${name} has unsaved changes`}
          className="h-2 w-2 shrink-0 rounded-full bg-foreground"
        />
      ) : (
        <span
          role="button"
          tabIndex={0}
          aria-label={`Close ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              onClose();
            }
          }}
          className="flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 data-[active=true]:opacity-60"
          data-active={active}
        >
          <X className="h-3 w-3" />
        </span>
      )}
    </button>
  );
}
```

In `EditorTabs.tsx`:
1. Subscribe: `const fileTabs = useWorkbench((s) => s.fileTabs);` `const activeFileTabId = useWorkbench((s) => s.activeFileTabId);` `const setActiveFileTab = useWorkbench((s) => s.setActiveFileTab);` `const closeFileTab = useWorkbench((s) => s.closeFileTab);` `const pinFileTab = useWorkbench((s) => s.pinFileTab);`
2. Local state `const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null);`
3. Render after the workspace tabs map:

```tsx
        {fileTabs.map((tab) => (
          <FileEditorTab
            key={tab.id}
            tab={tab}
            active={tab.id === activeFileTabId}
            onSelect={() => setActiveFileTab(tab.id)}
            onPin={() => pinFileTab(tab.id)}
            onClose={() => {
              if (!closeFileTab(tab.id)) setConfirmCloseId(tab.id);
            }}
          />
        ))}
```

4. Confirm dialog at the bottom, beside `SaveLayoutDialog`, using the project's existing `Dialog` primitives from `src/components/ui/dialog.tsx` (same imports `SaveLayoutDialog` uses):

```tsx
      <Dialog open={confirmCloseId !== null} onOpenChange={(o) => !o && setConfirmCloseId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>
              This file has unsaved changes. Close it anyway?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmCloseId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmCloseId) closeFileTab(confirmCloseId, { force: true });
                setConfirmCloseId(null);
              }}
            >
              Close without saving
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

(Check `src/components/ui/dialog.tsx` for the exact exported names and `src/components/ui/button.tsx` for `Button`; both exist — `SaveLayoutDialog` imports them.)

- [ ] **Step 4: Run to verify pass**

Run: `bun run test src/components/editor/`
Expected: PASS including pre-existing EditorTabs tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/FileEditorTab.tsx src/components/editor/FileEditorTab.test.tsx src/components/editor/EditorTabs.tsx src/components/editor/EditorTabs.test.tsx
git commit -m "feat(editor): file tabs with preview italics, dirty dot, confirm-close"
```

## Task B3: `EditorGroup` mounts file-tab panes (keep-alive)

**Files:**
- Create: `src/components/viewers/FileTabPane.tsx` (placeholder — D3 replaces the body)
- Modify: `src/components/editor/EditorGroup.tsx`
- Test: `src/components/editor/EditorGroup.test.tsx` (extend)

- [ ] **Step 1: Write failing tests** — add to `EditorGroup.test.tsx`:

```tsx
describe("file tabs", () => {
  it("mounts a pane per file tab, hidden when inactive (keep-alive)", async () => {
    useWorkbench.getState().openFileTab({ kind: "file", path: "/wt/a.ts", worktreePath: "/wt", preview: false });
    useWorkbench.getState().openFileTab({ kind: "file", path: "/wt/b.ts", worktreePath: "/wt", preview: false });
    render(<EditorGroup />);
    const a = await screen.findByTestId("file-tab-content-file:/wt/a.ts");
    const b = await screen.findByTestId("file-tab-content-file:/wt/b.ts");
    expect(a).toHaveAttribute("aria-hidden", "true");
    expect(b).toHaveAttribute("aria-hidden", "false");
  });
});
```

(Reuse the file's existing render helper/beforeEach; reset `fileTabs: [], activeFileTabId: null` in the shared beforeEach.)

- [ ] **Step 2: Run to verify failure**

Run: `bun run test src/components/editor/EditorGroup.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/components/viewers/FileTabPane.tsx` (placeholder body; the props contract is final):

```tsx
import type { FileTab } from "@/state/store";

export interface FileTabPaneProps {
  tab: FileTab;
  active: boolean;
}

// Body replaced in Task D3 with registry-driven viewer rendering.
export default function FileTabPane({ tab }: FileTabPaneProps) {
  return (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      {tab.path}
    </div>
  );
}
```

In `EditorGroup.tsx`:
1. `const FileTabPane = lazy(() => import("@/components/viewers/FileTabPane"));`
2. Subscribe `fileTabs`, `activeFileTabId`; include them in `hasAnyTabs`:
   `const hasAnyTabs = workspaces.length > 0 || systemTabs.length > 0 || terminalTabs.length > 0 || fileTabs.length > 0;`
3. `const showFileTab = !!activeFileTabId && fileTabs.some((t) => t.id === activeFileTabId);` and add `&& !showFileTab` to the `WorkspaceEditor` `active` prop expression so a focused file tab hides workspaces.
4. Render block after the terminal-tabs block (same keep-alive pattern):

```tsx
        {/* File tabs: keep-alive mounted, hidden when inactive so Monaco
            models, scroll position and undo stacks survive tab switches. */}
        {fileTabs.map((tab) => {
          const active = showFileTab && tab.id === activeFileTabId;
          return (
            <div
              key={tab.id}
              data-testid={`file-tab-content-${tab.id}`}
              aria-hidden={!active}
              className={cn(
                "absolute inset-0 bg-editor",
                !active && "keep-alive-hidden content-visibility-auto"
              )}
            >
              <Suspense fallback={null}>
                <FileTabPane tab={tab} active={active} />
              </Suspense>
            </div>
          );
        })}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun run test src/components/editor/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/viewers/FileTabPane.tsx src/components/editor/EditorGroup.tsx src/components/editor/EditorGroup.test.tsx
git commit -m "feat(editor): keep-alive file-tab panes in EditorGroup"
```

## Task B4: Entry points open tabs; delete the sidebar preview path

**Files:**
- Modify: `src/components/auxiliarybar/FilesView.tsx`
- Modify: `src/components/quickopen/QuickOpen.tsx`
- Modify: `src/components/auxiliarybar/AuxiliaryBar.tsx` (drop the Preview tab)
- Delete: `src/components/auxiliarybar/PreviewView.tsx` + its test
- Modify: `src/state/store.ts` (remove `previewFile`, `openPreview`, `closePreview`, `togglePreviewRaw`, `PreviewFile`)
- Modify: `src/lib/ipc.ts` (`AuxiliaryView` drops `"preview"`)
- Modify: tests: `FilesView.test.tsx`, `QuickOpen.test.tsx`, `AuxiliaryBar.test.tsx` (if present), delete `PreviewView.test.tsx`
- Keep: `src/panels/preview/*` components — they are promoted in Task D4, do NOT delete them.

- [ ] **Step 1: Update tests first**

- `FilesView.test.tsx`: replace `openPreview` assertions — clicking a file row must call `openFileTab` with `{ kind: "file", path: "<abs>", worktreePath: root, preview: true }`; add a double-click case asserting `preview: false`.
- `QuickOpen.test.tsx`: selecting a hit calls `openFileTab` with `preview: false`.
- Remove `aux-tab-preview` expectations anywhere.

Run: `bun run test src/components/auxiliarybar src/components/quickopen` — expect FAIL.

- [ ] **Step 2: Implement**

`FilesView.tsx` — replace the `openPreview` lines:

```tsx
  const openFileTab = useWorkbench((s) => s.openFileTab);

  const onOpen = (entry: FileEntry, opts: { pin?: boolean } = {}) => {
    const root = active?.worktreePath;
    if (!root) return;
    openFileTab({
      kind: "file",
      path: absPath(root, entry.path),
      worktreePath: root,
      preview: !opts.pin,
    });
  };
```

In `FileRow`, add `onDoubleClick` support: extend `RowProps.onOpen` to `(entry: FileEntry, opts?: { pin?: boolean }) => void`, and on the row div add `onDoubleClick={() => !isDir && onOpen(entry, { pin: true })}` (keep the single-click handler as is).

`QuickOpen.tsx` — replace `openPreview` usage:

```tsx
  const openFileTab = useWorkbench((s) => s.openFileTab);
  // in the select handler (line ~85), result.root is the worktree root:
  openFileTab({ kind: "file", path: joinPath(result.root, hit.rel), worktreePath: result.root, preview: false });
```

`AuxiliaryBar.tsx` — remove the `{ value: "preview", label: "Preview" }` entry, the `PreviewView` import, and its `TabsContent`.

`store.ts` — delete `PreviewFile`, `previewFile`, `openPreview`, `closePreview`, `togglePreviewRaw` (interface + implementation + initial value). `ipc.ts` — `export type AuxiliaryView = "files" | "diff" | "scm" | "none";`

Delete `src/components/auxiliarybar/PreviewView.tsx` and `PreviewView.test.tsx`. Then `grep -rn "openPreview\|previewFile\|PreviewView" src/` must return zero non-test hits; fix any stragglers (e.g. CommandPalette entries referencing preview).

- [ ] **Step 3: Verify**

Run: `bun run typecheck && bun run test`
Expected: PASS, full suite.

- [ ] **Step 4: Commit**

```bash
git add -A src/
git commit -m "feat(shell): file clicks open editor tabs; remove AuxiliaryBar preview path"
```

---

# Workstream C — Monaco infrastructure

## Task C1: Dependencies + test mocks

**Files:**
- Modify: `package.json` (via bun)
- Modify: `src/test/setup.ts`

- [ ] **Step 1: Install**

```bash
bun add monaco-editor shiki @shikijs/monaco papaparse
bun add -d @types/papaparse
```

(`xlsx` is added lazily in Task F1.) Bundle-budget justification to note in the eventual PR: monaco-editor is the editor + diff engine + future extension-host target in one dep; it is loaded only as a dynamic chunk on first file open.

- [ ] **Step 2: Add mocks to `src/test/setup.ts`** (next to the pdfjs mock):

```ts
// Monaco: full editor mock. Tests assert against globalThis.__monaco spies.
vi.mock("monaco-editor/esm/vs/editor/editor.api", () => {
  const makeModel = (value: string, language?: string, uri?: unknown) => {
    let v = value;
    const listeners: Array<() => void> = [];
    return {
      uri: uri ?? { toString: () => `inmemory://${Math.random()}` },
      getValue: () => v,
      setValue: (nv: string) => {
        v = nv;
        listeners.forEach((l) => l());
      },
      getLanguageId: () => language ?? "plaintext",
      onDidChangeContent: (cb: () => void) => {
        listeners.push(cb);
        return { dispose: vi.fn() };
      },
      isDisposed: () => false,
      dispose: vi.fn(),
    };
  };
  const models = new Map<string, ReturnType<typeof makeModel>>();
  const editorApi = {
    create: vi.fn(() => ({
      setModel: vi.fn(),
      getModel: vi.fn(),
      updateOptions: vi.fn(),
      onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() })),
      addCommand: vi.fn(),
      layout: vi.fn(),
      focus: vi.fn(),
      dispose: vi.fn(),
    })),
    createDiffEditor: vi.fn(() => ({
      setModel: vi.fn(),
      updateOptions: vi.fn(),
      getModifiedEditor: vi.fn(() => ({
        onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() })),
        addCommand: vi.fn(),
        focus: vi.fn(),
      })),
      layout: vi.fn(),
      dispose: vi.fn(),
    })),
    createModel: vi.fn((value: string, language?: string, uri?: { toString(): string }) => {
      const m = makeModel(value, language, uri);
      if (uri) models.set(uri.toString(), m);
      return m;
    }),
    getModel: vi.fn((uri: { toString(): string }) => models.get(uri.toString()) ?? null),
    setModelLanguage: vi.fn(),
    defineTheme: vi.fn(),
    setTheme: vi.fn(),
  };
  const monaco = {
    editor: editorApi,
    languages: { register: vi.fn(), getLanguages: vi.fn(() => []) },
    Uri: { file: (p: string) => ({ toString: () => `file://${p}`, path: p }) },
    KeyMod: { CtrlCmd: 2048 },
    KeyCode: { KeyS: 49 },
  };
  (globalThis as Record<string, unknown>).__monaco = monaco;
  return monaco;
});

vi.mock("monaco-editor/esm/vs/editor/editor.worker?worker", () => ({
  default: class {
    terminate = vi.fn();
  },
}));

vi.mock("shiki", () => ({
  createHighlighter: vi.fn(async () => ({
    getLoadedLanguages: vi.fn(() => ["typescript"]),
    loadLanguage: vi.fn(async () => {}),
  })),
}));

vi.mock("@shikijs/monaco", () => ({
  shikiToMonaco: vi.fn(),
}));
```

- [ ] **Step 3: Verify nothing broke**

Run: `bun run test`
Expected: PASS (mocks are inert until imported).

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock src/test/setup.ts
git commit -m "chore(viewers): add monaco/shiki/papaparse deps + test mocks"
```

## Task C2: Monaco loader singleton + workers + theme

**Files:**
- Create: `src/lib/viewers/monaco/loader.ts`
- Create: `src/lib/viewers/monaco/maverick-theme.ts`
- Create: `src/lib/viewers/monaco/languages.ts`
- Test: `src/lib/viewers/monaco/loader.test.ts`, `src/lib/viewers/monaco/languages.test.ts`

- [ ] **Step 1: Write failing tests**

`src/lib/viewers/monaco/languages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { languageForPath, SHIKI_LANGS } from "./languages";

describe("languageForPath", () => {
  it.each([
    ["/a/b.ts", "typescript"],
    ["/a/b.tsx", "tsx"],
    ["/a/b.js", "javascript"],
    ["/a/b.jsx", "jsx"],
    ["/a/b.rs", "rust"],
    ["/a/b.py", "python"],
    ["/a/b.go", "go"],
    ["/a/b.json", "json"],
    ["/a/b.css", "css"],
    ["/a/b.html", "html"],
    ["/a/b.md", "markdown"],
    ["/a/b.yaml", "yaml"],
    ["/a/b.yml", "yaml"],
    ["/a/b.toml", "toml"],
    ["/a/b.sh", "shellscript"],
    ["/a/b.sql", "sql"],
    ["/a/b.swift", "swift"],
    ["/a/Dockerfile", "docker"],
  ])("%s -> %s", (path, lang) => {
    expect(languageForPath(path)).toBe(lang);
  });

  it("unknown extension falls back to plaintext", () => {
    expect(languageForPath("/a/b.xyzzy")).toBe("plaintext");
  });

  it("every mapped language is in SHIKI_LANGS or plaintext", () => {
    expect(SHIKI_LANGS.length).toBeGreaterThan(10);
  });
});
```

`src/lib/viewers/monaco/loader.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getMonaco } from "./loader";

describe("getMonaco", () => {
  it("returns the same instance on repeated calls (singleton)", async () => {
    const a = await getMonaco();
    const b = await getMonaco();
    expect(a).toBe(b);
    expect(a).toBe((globalThis as Record<string, unknown>).__monaco);
  });

  it("registers languages and applies the shiki bridge once", async () => {
    const monaco = await getMonaco();
    const { shikiToMonaco } = await import("@shikijs/monaco");
    expect(shikiToMonaco).toHaveBeenCalledTimes(1);
    expect(monaco.languages.register).toHaveBeenCalled();
  });
});
```

Run: `bun run test src/lib/viewers/monaco/` — expect FAIL (modules missing).

- [ ] **Step 2: Implement**

`src/lib/viewers/monaco/languages.ts`:

```ts
// Shiki language ids per extension. Grammars lazy-load on first use; anything
// unmapped renders as plaintext rather than failing.
const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", mts: "typescript", cts: "typescript",
  tsx: "tsx",
  js: "javascript", mjs: "javascript", cjs: "javascript",
  jsx: "jsx",
  json: "json", jsonc: "jsonc",
  rs: "rust",
  py: "python",
  go: "go",
  rb: "ruby",
  java: "java",
  c: "c", h: "c",
  cpp: "cpp", cc: "cpp", hpp: "cpp",
  cs: "csharp",
  css: "css", scss: "scss", less: "less",
  html: "html", htm: "html",
  md: "markdown", markdown: "markdown", mdx: "mdx",
  yaml: "yaml", yml: "yaml",
  toml: "toml",
  sh: "shellscript", bash: "shellscript", zsh: "shellscript",
  sql: "sql",
  swift: "swift",
  kt: "kotlin",
  php: "php",
  xml: "xml", svg: "xml", plist: "xml",
  vue: "vue",
  svelte: "svelte",
  graphql: "graphql", gql: "graphql",
  lua: "lua",
  r: "r",
  dart: "dart",
  tf: "hcl",
  proto: "proto",
  ini: "ini", conf: "ini", env: "ini",
};

const FILENAME_TO_LANG: Record<string, string> = {
  dockerfile: "docker",
  makefile: "makefile",
};

export const SHIKI_LANGS: string[] = [...new Set([
  ...Object.values(EXT_TO_LANG),
  ...Object.values(FILENAME_TO_LANG),
])];

export function languageForPath(path: string): string {
  const name = (path.split("/").pop() ?? "").toLowerCase();
  if (FILENAME_TO_LANG[name]) return FILENAME_TO_LANG[name];
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1) : "";
  return EXT_TO_LANG[ext] ?? "plaintext";
}
```

`src/lib/viewers/monaco/maverick-theme.ts`:

```ts
import type { ThemeRegistrationAny } from "shiki";

// VSCode-format theme derived from src/styles/tokens.css: true-black canvas,
// 96% foreground, purple accent (hsl(263 70% 60%) ≈ #8b5cf6).
export const MAVERICK_DARK: ThemeRegistrationAny = {
  name: "maverick-dark",
  type: "dark",
  colors: {
    "editor.background": "#000000",
    "editor.foreground": "#f5f5f5",
    "editorLineNumber.foreground": "#4d4d4d",
    "editorLineNumber.activeForeground": "#a3a3a3",
    "editorCursor.foreground": "#8b5cf6",
    "editor.selectionBackground": "#8b5cf640",
    "editor.lineHighlightBackground": "#121212",
    "editorWidget.background": "#121212",
    "editorWidget.border": "#242424",
    "diffEditor.insertedTextBackground": "#22c55e22",
    "diffEditor.removedTextBackground": "#ef444422",
    "diffEditor.insertedLineBackground": "#22c55e14",
    "diffEditor.removedLineBackground": "#ef444414",
  },
  tokenColors: [
    { scope: ["comment"], settings: { foreground: "#6b7280", fontStyle: "italic" } },
    { scope: ["string"], settings: { foreground: "#a5d6a7" } },
    { scope: ["constant.numeric", "constant.language"], settings: { foreground: "#f0abfc" } },
    { scope: ["keyword", "storage.type", "storage.modifier"], settings: { foreground: "#c4b5fd" } },
    { scope: ["entity.name.function", "support.function"], settings: { foreground: "#93c5fd" } },
    { scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: "#7dd3fc" } },
    { scope: ["variable", "variable.parameter"], settings: { foreground: "#f5f5f5" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#f9a8d4" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#c4b5fd" } },
    { scope: ["punctuation"], settings: { foreground: "#a3a3a3" } },
  ],
};
```

`src/lib/viewers/monaco/loader.ts`:

```ts
// The ONLY module allowed to import monaco-editor (CLAUDE.md rule 4 analogue:
// everything else goes through getMonaco()). Loaded lazily — first file tab
// pays the chunk cost, the Workbench never does.
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { MAVERICK_DARK } from "./maverick-theme";
import { SHIKI_LANGS, languageForPath } from "./languages";

export type Monaco = typeof MonacoApi;

let instance: Promise<Monaco> | null = null;

async function boot(): Promise<Monaco> {
  const [monaco, { default: EditorWorker }] = await Promise.all([
    import("monaco-editor/esm/vs/editor/editor.api"),
    import("monaco-editor/esm/vs/editor/editor.worker?worker"),
  ]);

  // Shiki owns tokenization; Monaco only needs its base editor worker.
  (self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
    getWorker: () => new EditorWorker(),
  };

  const { createHighlighter } = await import("shiki");
  const { shikiToMonaco } = await import("@shikijs/monaco");

  // Languages register as empty shells; shiki grammars stream in per-language
  // on demand via ensureLanguage(), keeping first paint fast.
  for (const id of SHIKI_LANGS) monaco.languages.register({ id });
  const highlighter = await createHighlighter({ themes: [MAVERICK_DARK], langs: [] });
  shikiToMonaco(highlighter, monaco);
  monaco.editor.setTheme("maverick-dark");

  loadedLangs = new Set(highlighter.getLoadedLanguages());
  highlighterRef = highlighter;
  return monaco;
}

let highlighterRef: Awaited<ReturnType<typeof import("shiki").createHighlighter>> | null = null;
let loadedLangs = new Set<string>();

export function getMonaco(): Promise<Monaco> {
  if (!instance) instance = boot();
  return instance;
}

/** Lazy-load the TextMate grammar for a file's language; returns the language id. */
export async function ensureLanguage(path: string): Promise<string> {
  const lang = languageForPath(path);
  if (lang === "plaintext" || !highlighterRef) return lang;
  if (!loadedLangs.has(lang)) {
    try {
      await highlighterRef.loadLanguage(lang as never);
      loadedLangs.add(lang);
    } catch {
      return "plaintext"; // grammar unavailable — degrade, don't fail the tab
    }
  }
  return lang;
}
```

Note for the loader test: the shiki mock's `getLoadedLanguages` returns `["typescript"]`, so `ensureLanguage("/a.ts")` resolves without calling `loadLanguage`. Add an `ensureLanguage` test case asserting exactly that, plus one for an unloaded language calling `loadLanguage`.

- [ ] **Step 3: Run to verify pass**

Run: `bun run test src/lib/viewers/monaco/ && bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/viewers/monaco/
git commit -m "feat(viewers): monaco loader singleton with shiki TextMate bridge + maverick-dark theme"
```

## Task C3: Monaco model cache

**Files:**
- Create: `src/lib/viewers/monaco/model-cache.ts`
- Test: `src/lib/viewers/monaco/model-cache.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { getOrCreateModel, releaseModel, __resetModelCache } from "./model-cache";

describe("model cache", () => {
  beforeEach(() => __resetModelCache());

  it("creates one model per path and reuses it", async () => {
    const a = await getOrCreateModel("/wt/a.ts", "x");
    const b = await getOrCreateModel("/wt/a.ts", "ignored — model exists");
    expect(a).toBe(b);
    expect(a.getValue()).toBe("x");
  });

  it("releaseModel disposes when the last holder releases", async () => {
    const m = await getOrCreateModel("/wt/a.ts", "x");
    await getOrCreateModel("/wt/a.ts", "x"); // second holder
    releaseModel("/wt/a.ts");
    expect(m.dispose).not.toHaveBeenCalled();
    releaseModel("/wt/a.ts");
    expect(m.dispose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement `src/lib/viewers/monaco/model-cache.ts`:

```ts
// Refcounted text models keyed by absolute path. CodeViewer and DiffViewer
// share one model per file so edits persist across Diff⟷Edit mode switches.
import { getMonaco, ensureLanguage } from "./loader";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";

type TextModel = MonacoApi.editor.ITextModel;

const cache = new Map<string, { model: TextModel; refs: number }>();

export async function getOrCreateModel(path: string, content: string): Promise<TextModel> {
  const entry = cache.get(path);
  if (entry) {
    entry.refs += 1;
    return entry.model;
  }
  const monaco = await getMonaco();
  const lang = await ensureLanguage(path);
  const uri = monaco.Uri.file(path);
  const model =
    monaco.editor.getModel(uri) ?? monaco.editor.createModel(content, lang, uri);
  cache.set(path, { model, refs: 1 });
  return model;
}

export function releaseModel(path: string): void {
  const entry = cache.get(path);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs <= 0) {
    cache.delete(path);
    entry.model.dispose();
  }
}

/** Test-only. */
export function __resetModelCache(): void {
  cache.clear();
}
```

- [ ] **Step 3: Run to verify pass**

Run: `bun run test src/lib/viewers/monaco/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/viewers/monaco/model-cache.ts src/lib/viewers/monaco/model-cache.test.ts
git commit -m "feat(viewers): refcounted monaco model cache"
```

---

# Workstream D — Viewer registry, toolbar, simple viewers

## Task D1: Viewer contract + `ViewerRegistry`

**Files:**
- Create: `src/lib/viewers/types.ts`
- Create: `src/lib/viewers/registry.ts`
- Create: `src/lib/viewers/registry.test.ts`

- [ ] **Step 1: Write failing tests** — `src/lib/viewers/registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ViewerRegistry } from "./registry";
import type { ViewerDescriptor } from "./types";

const stub = (over: Partial<ViewerDescriptor>): ViewerDescriptor => ({
  id: "stub",
  displayName: "Stub",
  priority: 0,
  capabilities: {},
  canHandle: () => true,
  load: async () => () => null,
  ...over,
});

const meta = { path: "/wt/a.md", name: "a.md", ext: "md", binary: false, size: 10 };

describe("ViewerRegistry", () => {
  it("resolves matching descriptors ordered by priority desc", () => {
    const r = new ViewerRegistry();
    r.register(stub({ id: "low", priority: 1 }));
    r.register(stub({ id: "high", priority: 9 }));
    r.register(stub({ id: "no", canHandle: () => false }));
    expect(r.resolve(meta, "preview").map((d) => d.id)).toEqual(["high", "low"]);
  });

  it("get returns a descriptor by id, undefined for unknown", () => {
    const r = new ViewerRegistry();
    r.register(stub({ id: "x" }));
    expect(r.get("x")?.id).toBe("x");
    expect(r.get("nope")).toBeUndefined();
  });

  it("rejects duplicate ids", () => {
    const r = new ViewerRegistry();
    r.register(stub({ id: "x" }));
    expect(() => r.register(stub({ id: "x" }))).toThrow(/duplicate/i);
  });

  it("passes intent into canHandle", () => {
    const r = new ViewerRegistry();
    r.register(stub({ id: "diff-only", canHandle: (_f, intent) => intent === "diff" }));
    expect(r.resolve(meta, "diff").map((d) => d.id)).toEqual(["diff-only"]);
    expect(r.resolve(meta, "preview")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement.

`src/lib/viewers/types.ts`:

```ts
import type { ComponentType } from "react";
import type { FileTab } from "@/state/store";

export type ViewerIntent = "preview" | "edit" | "diff";

export interface FileMeta {
  /** Absolute path. */
  path: string;
  /** Basename. */
  name: string;
  /** Lowercase extension without the dot; "" when none. */
  ext: string;
  binary: boolean;
  size: number;
}

export interface ViewerActions {
  save?: () => Promise<void>;
  copyContents?: () => Promise<void>;
  discardChanges?: () => Promise<void>;
}

export interface ViewerProps {
  tab: FileTab;
  meta: FileMeta;
  onDirtyChange: (dirty: boolean) => void;
  /** Viewers register imperative actions; the toolbar binds its buttons to them. */
  registerActions: (actions: ViewerActions) => void;
}

export interface ViewerDescriptor {
  id: string;
  displayName: string;
  /** Higher wins among canHandle matches. */
  priority: number;
  capabilities: { edit?: boolean; diff?: boolean };
  canHandle: (file: FileMeta, intent: ViewerIntent) => boolean;
  /** Every viewer lazy-loads — heavy deps stay out of the shell bundle. */
  load: () => Promise<ComponentType<ViewerProps>>;
}

export function fileMetaForPath(path: string, opts: { binary?: boolean; size?: number } = {}): FileMeta {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return {
    path,
    name,
    ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : "",
    binary: opts.binary ?? false,
    size: opts.size ?? 0,
  };
}
```

`src/lib/viewers/registry.ts`:

```ts
import type { FileMeta, ViewerDescriptor, ViewerIntent } from "./types";

export class ViewerRegistry {
  private descriptors = new Map<string, ViewerDescriptor>();

  register(descriptor: ViewerDescriptor): void {
    if (this.descriptors.has(descriptor.id)) {
      throw new Error(`duplicate viewer id: ${descriptor.id}`);
    }
    this.descriptors.set(descriptor.id, descriptor);
  }

  get(id: string): ViewerDescriptor | undefined {
    return this.descriptors.get(id);
  }

  all(): ViewerDescriptor[] {
    return [...this.descriptors.values()];
  }

  /** Priority-ordered candidates; index 0 is the default, the rest feed "Open With…". */
  resolve(file: FileMeta, intent: ViewerIntent): ViewerDescriptor[] {
    return this.all()
      .filter((d) => d.canHandle(file, intent))
      .sort((a, b) => b.priority - a.priority);
  }
}

/** App-wide singleton; viewers self-register in src/lib/viewers/index.ts. */
export const viewerRegistry = new ViewerRegistry();
```

- [ ] **Step 3: Run to verify pass** — `bun run test src/lib/viewers/`

- [ ] **Step 4: Commit**

```bash
git add src/lib/viewers/types.ts src/lib/viewers/registry.ts src/lib/viewers/registry.test.ts
git commit -m "feat(viewers): ViewerRegistry + viewer contract"
```

## Task D2: `ViewerToolbar` (Conductor-style bar)

**Files:**
- Create: `src/components/viewers/ViewerToolbar.tsx`
- Create: `src/components/viewers/ViewerToolbar.test.tsx`

- [ ] **Step 1: Write failing tests**:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { useWorkbench } from "@/state/store";
import { ViewerToolbar } from "./ViewerToolbar";
import type { ViewerActions } from "@/lib/viewers/types";

function setup(tabOverrides: Record<string, unknown> = {}, actions: ViewerActions = {}) {
  useWorkbench.setState({ fileTabs: [], activeFileTabId: null });
  useWorkbench.getState().openFileTab({
    kind: "diff",
    path: "/wt/src/components/A.tsx",
    worktreePath: "/wt",
    preview: false,
    ...(tabOverrides as object),
  });
  const tab = useWorkbench.getState().fileTabs[0];
  const candidates = [
    { id: "diff", displayName: "Diff", priority: 5, capabilities: { diff: true }, canHandle: () => true, load: async () => () => null },
    { id: "hex", displayName: "Hex", priority: 0, capabilities: {}, canHandle: () => true, load: async () => () => null },
  ];
  render(<ViewerToolbar tab={tab} actions={actions} candidates={candidates as never} />);
  return tab;
}

describe("ViewerToolbar", () => {
  it("renders the breadcrumb path relative to the worktree", () => {
    setup();
    expect(screen.getByText("src")).toBeInTheDocument();
    expect(screen.getByText("components")).toBeInTheDocument();
    expect(screen.getByText("A.tsx")).toBeInTheDocument();
  });

  it("Diff/Edit switcher sets tab mode", () => {
    const tab = setup();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(useWorkbench.getState().fileTabs[0].mode).toBe("edit");
    fireEvent.click(screen.getByRole("button", { name: "Diff" }));
    expect(useWorkbench.getState().fileTabs[0].mode).toBe("diff");
    void tab;
  });

  it("copy button calls the registered action", () => {
    const copyContents = vi.fn(async () => {});
    setup({}, { copyContents });
    fireEvent.click(screen.getByRole("button", { name: /copy contents/i }));
    expect(copyContents).toHaveBeenCalled();
  });

  it("undo changes asks for confirmation then calls discardChanges", async () => {
    const discardChanges = vi.fn(async () => {});
    setup({}, { discardChanges });
    fireEvent.click(screen.getByRole("button", { name: /undo changes/i }));
    expect(discardChanges).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /discard/i }));
    expect(discardChanges).toHaveBeenCalled();
  });

  it("viewed checkbox toggles tab.viewed on diff tabs", () => {
    setup();
    fireEvent.click(screen.getByRole("checkbox", { name: /viewed/i }));
    expect(useWorkbench.getState().fileTabs[0].viewed).toBe(true);
  });

  it("save button appears when dirty and calls the save action", () => {
    const save = vi.fn(async () => {});
    setup({}, { save });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    act(() => {
      useWorkbench.getState().setFileTabDirty(useWorkbench.getState().fileTabs[0].id, true);
    });
    const btn = screen.getByRole("button", { name: "Save" });
    fireEvent.click(btn);
    expect(save).toHaveBeenCalled();
  });

  it("Open With menu lists candidates and sets viewerId", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /open with/i }));
    fireEvent.click(screen.getByText("Hex"));
    expect(useWorkbench.getState().fileTabs[0].viewerId).toBe("hex");
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement `src/components/viewers/ViewerToolbar.tsx`:

```tsx
import { useState } from "react";
import { ChevronRight, Copy, Save, Undo2 } from "lucide-react";
import { useWorkbench, type FileTab } from "@/state/store";
import type { ViewerActions, ViewerDescriptor } from "@/lib/viewers/types";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface Props {
  tab: FileTab;
  actions: ViewerActions;
  candidates: ViewerDescriptor[];
}

function relSegments(tab: FileTab): string[] {
  const rel = tab.path.startsWith(tab.worktreePath)
    ? tab.path.slice(tab.worktreePath.length).replace(/^\//, "")
    : tab.path;
  return rel.split("/").filter(Boolean);
}

export function ViewerToolbar({ tab, actions, candidates }: Props) {
  const live = useWorkbench((s) => s.fileTabs.find((t) => t.id === tab.id)) ?? tab;
  const setFileTabMode = useWorkbench((s) => s.setFileTabMode);
  const setFileTabViewer = useWorkbench((s) => s.setFileTabViewer);
  const setFileTabViewed = useWorkbench((s) => s.setFileTabViewed);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const segments = relSegments(live);
  const showDiffSwitch = live.kind === "diff";

  return (
    <div
      data-testid="viewer-toolbar"
      className="mv-viewertoolbar flex h-8 shrink-0 items-center gap-2 border-b border-border bg-background px-2"
    >
      <nav aria-label="File path" className="flex min-w-0 flex-1 items-center gap-0.5 text-[11px] text-muted-foreground">
        {segments.map((seg, i) => (
          <span key={`${seg}-${i}`} className="flex items-center gap-0.5">
            {i > 0 && <ChevronRight className="h-3 w-3 opacity-50" />}
            <span className={cn("truncate", i === segments.length - 1 && "text-foreground")}>{seg}</span>
          </span>
        ))}
      </nav>

      {showDiffSwitch && (
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            aria-label="Viewed"
            checked={live.viewed}
            onChange={(e) => setFileTabViewed(live.id, e.target.checked)}
            className="h-3 w-3 accent-accent"
          />
          Viewed
        </label>
      )}

      {live.dirty && actions.save && (
        <Button variant="ghost" size="sm" aria-label="Save" onClick={() => void actions.save?.()}>
          <Save className="h-3.5 w-3.5" />
          Save
        </Button>
      )}

      {actions.discardChanges && (
        <Button variant="ghost" size="sm" aria-label="Undo changes" onClick={() => setConfirmDiscard(true)}>
          <Undo2 className="h-3.5 w-3.5" />
          Undo changes
        </Button>
      )}

      {actions.copyContents && (
        <Button variant="ghost" size="sm" aria-label="Copy contents" onClick={() => void actions.copyContents?.()}>
          <Copy className="h-3.5 w-3.5" />
        </Button>
      )}

      {showDiffSwitch && (
        <div role="group" aria-label="View mode" className="flex overflow-hidden rounded-md border border-border">
          {(["diff", "edit"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-label={m === "diff" ? "Diff" : "Edit"}
              onClick={() => setFileTabMode(live.id, m)}
              className={cn(
                "px-2 py-0.5 text-[11px] capitalize transition-colors duration-100",
                live.mode === m ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-foreground/5"
              )}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      {candidates.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" aria-label="Open with">
              Open With…
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {candidates.map((d) => (
              <DropdownMenuItem key={d.id} onClick={() => setFileTabViewer(live.id, d.id)}>
                {d.displayName}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Undo changes</DialogTitle>
            <DialogDescription>
              Discard all working-tree changes to {segments[segments.length - 1]}? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmDiscard(false);
                void actions.discardChanges?.();
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

(Verify the exact `Button` size variants in `src/components/ui/button.tsx` — if `size="sm"` doesn't exist, use the closest available and keep classes token-based. The "Diff/Edit" group also serves markdown View/Edit when D4 passes `kind:"file"` markdown tabs `mode` — see D4 note.)

- [ ] **Step 3: Run to verify pass** — `bun run test src/components/viewers/ViewerToolbar.test.tsx`

- [ ] **Step 4: Commit**

```bash
git add src/components/viewers/ViewerToolbar.tsx src/components/viewers/ViewerToolbar.test.tsx
git commit -m "feat(viewers): Conductor-style ViewerToolbar"
```

## Task D3: Real `FileTabPane` — registry-driven dispatch

**Files:**
- Modify: `src/components/viewers/FileTabPane.tsx` (replace placeholder body)
- Create: `src/components/viewers/FileTabPane.test.tsx`
- Create: `src/lib/viewers/index.ts` (registration barrel — starts empty, D4/E/F add entries)

- [ ] **Step 1: Create the barrel** — `src/lib/viewers/index.ts`:

```ts
// Self-registration barrel: importing this module populates viewerRegistry.
// FileTabPane is the only consumer. Each viewer task appends its register() call.
import { viewerRegistry } from "./registry";

export { viewerRegistry };
```

- [ ] **Step 2: Write failing tests** — `src/components/viewers/FileTabPane.test.tsx`:

```tsx
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useWorkbench } from "@/state/store";
import { viewerRegistry } from "@/lib/viewers";
import { invoke } from "@tauri-apps/api/core";
import FileTabPane from "./FileTabPane";

const invokeMock = vi.mocked(invoke);

function makeTab(path = "/wt/a.zzz") {
  useWorkbench.setState({ fileTabs: [], activeFileTabId: null });
  useWorkbench.getState().openFileTab({ kind: "file", path, worktreePath: "/wt", preview: false });
  return useWorkbench.getState().fileTabs[0];
}

describe("FileTabPane", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({
      content: "hello", size: 5, binary: false, unreadable: false, mtime: 1,
    });
  });

  it("renders the toolbar and the resolved viewer", async () => {
    const tab = makeTab();
    // register a catch-all test viewer at top priority
    if (!viewerRegistry.get("test-viewer")) {
      viewerRegistry.register({
        id: "test-viewer",
        displayName: "Test",
        priority: 999,
        capabilities: {},
        canHandle: () => true,
        load: async () => () => <div data-testid="test-viewer-body" />,
      });
    }
    render(<FileTabPane tab={tab} active />);
    expect(await screen.findByTestId("viewer-toolbar")).toBeInTheDocument();
    expect(await screen.findByTestId("test-viewer-body")).toBeInTheDocument();
  });

  it("honors tab.viewerId override", async () => {
    const tab = makeTab("/wt/b.zzz");
    if (!viewerRegistry.get("override-viewer")) {
      viewerRegistry.register({
        id: "override-viewer",
        displayName: "Override",
        priority: 0,
        capabilities: {},
        canHandle: () => false, // never resolved organically
        load: async () => () => <div data-testid="override-viewer-body" />,
      });
    }
    useWorkbench.getState().setFileTabViewer(tab.id, "override-viewer");
    render(<FileTabPane tab={useWorkbench.getState().fileTabs[0]} active />);
    expect(await screen.findByTestId("override-viewer-body")).toBeInTheDocument();
  });
});
```

(`src/test/setup.ts` mocks `@tauri-apps/api/core`'s `invoke` as a `vi.fn()`, so `vi.mocked(invoke)` works directly — same pattern as `FilesView.test.tsx`.)

- [ ] **Step 3: Run to verify failure**, then implement `src/components/viewers/FileTabPane.tsx`:

```tsx
import { Suspense, lazy, useEffect, useMemo, useState, type ComponentType } from "react";
import { useWorkbench, type FileTab } from "@/state/store";
import { viewerRegistry } from "@/lib/viewers";
import { fileMetaForPath, type FileMeta, type ViewerActions, type ViewerIntent, type ViewerProps } from "@/lib/viewers/types";
import { fileRead } from "@/lib/tauri";
import { ViewerToolbar } from "./ViewerToolbar";

export interface FileTabPaneProps {
  tab: FileTab;
  active: boolean;
}

function intentFor(tab: FileTab): ViewerIntent {
  if (tab.kind === "diff" && tab.mode === "diff") return "diff";
  return tab.mode === "view" ? "preview" : "edit";
}

export default function FileTabPane({ tab }: FileTabPaneProps) {
  const live = useWorkbench((s) => s.fileTabs.find((t) => t.id === tab.id)) ?? tab;
  const setFileTabDirty = useWorkbench((s) => s.setFileTabDirty);
  const [meta, setMeta] = useState<FileMeta | null>(null);
  const [actions, setActions] = useState<ViewerActions>({});

  useEffect(() => {
    let cancelled = false;
    fileRead(live.path)
      .then((res) => {
        if (!cancelled) setMeta(fileMetaForPath(live.path, { binary: res.binary, size: res.size }));
      })
      .catch(() => {
        if (!cancelled) setMeta(fileMetaForPath(live.path));
      });
    return () => {
      cancelled = true;
    };
  }, [live.path]);

  const intent = intentFor(live);
  const candidates = useMemo(
    () => (meta ? viewerRegistry.resolve(meta, intent) : []),
    [meta, intent]
  );
  const descriptor =
    (live.viewerId && viewerRegistry.get(live.viewerId)) || candidates[0];

  const Viewer = useMemo<ComponentType<ViewerProps> | null>(() => {
    if (!descriptor) return null;
    return lazy(async () => ({ default: await descriptor.load() }));
  }, [descriptor]);

  if (!meta) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <ViewerToolbar tab={live} actions={actions} candidates={candidates} />
      <div className="min-h-0 flex-1 overflow-hidden">
        {Viewer ? (
          <Suspense fallback={null}>
            <Viewer
              tab={live}
              meta={meta}
              onDirtyChange={(d) => setFileTabDirty(live.id, d)}
              registerActions={setActions}
            />
          </Suspense>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            No viewer available for this file.
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass** — `bun run test src/components/viewers/ && bun run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/lib/viewers/index.ts src/components/viewers/FileTabPane.tsx src/components/viewers/FileTabPane.test.tsx
git commit -m "feat(viewers): registry-driven FileTabPane with toolbar + lazy viewer dispatch"
```

## Task D4: Promote markdown / image / video / pdf / hex viewers

**Files:**
- Create: `src/components/viewers/MarkdownViewer.tsx`
- Create: `src/components/viewers/MediaViewers.tsx` (image + video wrappers)
- Create: `src/components/viewers/PdfViewer.tsx`
- Create: `src/components/viewers/HexViewer.tsx`
- Modify: `src/lib/viewers/index.ts` (register all)
- Create: `src/components/viewers/builtin-viewers.test.tsx`
- Keep `src/panels/preview/*` as the underlying implementations (wrapped, not rewritten).

- [ ] **Step 1: Write failing tests** — `src/components/viewers/builtin-viewers.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { viewerRegistry } from "@/lib/viewers";
import { fileMetaForPath } from "@/lib/viewers/types";

describe("builtin viewer registration", () => {
  it.each([
    ["/wt/readme.md", "preview", "markdown"],
    ["/wt/logo.png", "preview", "image"],
    ["/wt/demo.mp4", "preview", "video"],
    ["/wt/doc.pdf", "preview", "pdf"],
  ])("%s + %s resolves to %s", (path, intent, expected) => {
    const winner = viewerRegistry.resolve(fileMetaForPath(path), intent as never)[0];
    expect(winner?.id).toBe(expected);
  });

  it("binary files fall back to hex", () => {
    const meta = fileMetaForPath("/wt/blob.bin", { binary: true });
    expect(viewerRegistry.resolve(meta, "preview")[0]?.id).toBe("hex");
  });

  it("markdown supports edit intent (View/Edit toggle)", () => {
    const meta = fileMetaForPath("/wt/readme.md");
    const ids = viewerRegistry.resolve(meta, "edit").map((d) => d.id);
    expect(ids).toContain("markdown");
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement.

`src/components/viewers/MarkdownViewer.tsx` — wraps the existing preview; edit mode arrives with the code viewer (E1) via mode switch, until then edit intent shows source in a `<pre>`:

```tsx
import { useEffect, useState } from "react";
import MarkdownPreview from "@/panels/preview/MarkdownPreview";
import { fileRead } from "@/lib/tauri";
import type { ViewerProps } from "@/lib/viewers/types";

export default function MarkdownViewer({ tab, registerActions }: ViewerProps) {
  const [content, setContent] = useState("");

  useEffect(() => {
    let cancelled = false;
    fileRead(tab.path).then((res) => {
      if (!cancelled) setContent(res.unreadable || res.binary ? "" : res.content);
    });
    return () => {
      cancelled = true;
    };
  }, [tab.path]);

  useEffect(() => {
    registerActions({
      copyContents: async () => {
        await navigator.clipboard.writeText(content);
      },
    });
  }, [content, registerActions]);

  return <MarkdownPreview content={content} />;
}
```

`src/components/viewers/MediaViewers.tsx`:

```tsx
import ImagePreview from "@/panels/preview/ImagePreview";
import VideoPreview from "@/panels/preview/VideoPreview";
import type { ViewerProps } from "@/lib/viewers/types";

export function ImageViewer({ tab }: ViewerProps) {
  return <ImagePreview filePath={tab.path} />;
}

export function VideoViewer({ tab }: ViewerProps) {
  return <VideoPreview filePath={tab.path} />;
}
```

`src/components/viewers/PdfViewer.tsx`:

```tsx
import PDFPreview from "@/panels/preview/PDFPreview";
import type { ViewerProps } from "@/lib/viewers/types";

export default function PdfViewer({ tab }: ViewerProps) {
  return <PDFPreview filePath={tab.path} />;
}
```

`src/components/viewers/HexViewer.tsx`:

```tsx
import { useEffect, useState } from "react";
import RawPreview from "@/panels/preview/RawPreview";
import { fileRead } from "@/lib/tauri";
import type { ViewerProps } from "@/lib/viewers/types";

export default function HexViewer({ tab }: ViewerProps) {
  const [content, setContent] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fileRead(tab.path).then((res) => {
      if (!cancelled) setContent(res.unreadable ? "" : res.content);
    });
    return () => {
      cancelled = true;
    };
  }, [tab.path]);

  return <RawPreview filePath={tab.path} content={content} />;
}
```

Registrations in `src/lib/viewers/index.ts` (append below the existing export):

```ts
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v"]);

viewerRegistry.register({
  id: "markdown",
  displayName: "Markdown Preview",
  priority: 50,
  capabilities: { edit: true },
  canHandle: (f, intent) =>
    !f.binary && (f.ext === "md" || f.ext === "markdown" || f.ext === "mdx") && intent !== "diff",
  load: async () => (await import("@/components/viewers/MarkdownViewer")).default,
});

viewerRegistry.register({
  id: "image",
  displayName: "Image Viewer",
  priority: 50,
  capabilities: {},
  canHandle: (f, intent) => IMAGE_EXT.has(f.ext) && intent !== "diff",
  load: async () => (await import("@/components/viewers/MediaViewers")).ImageViewer,
});

viewerRegistry.register({
  id: "video",
  displayName: "Video Player",
  priority: 50,
  capabilities: {},
  canHandle: (f, intent) => VIDEO_EXT.has(f.ext) && intent !== "diff",
  load: async () => (await import("@/components/viewers/MediaViewers")).VideoViewer,
});

viewerRegistry.register({
  id: "pdf",
  displayName: "PDF Viewer",
  priority: 50,
  capabilities: {},
  canHandle: (f, intent) => f.ext === "pdf" && intent !== "diff",
  load: async () => (await import("@/components/viewers/PdfViewer")).default,
});

viewerRegistry.register({
  id: "hex",
  displayName: "Hex / Raw",
  priority: -10, // catch-all floor: wins only when nothing else matches
  capabilities: {},
  canHandle: () => true,
  load: async () => (await import("@/components/viewers/HexViewer")).default,
});
```

Markdown note: markdown file tabs should open in `mode: "view"` — in `FilesView.onOpen` this stays generic; instead `openFileTab` already defaults `mode: "edit"` for `kind:"file"`. Change `MarkdownViewer`'s registration to win the "edit" intent too (it does, via `intent !== "diff"`), and have D4 adjust `FilesView.onOpen` to pass `mode: "view"` when the name ends in `.md/.mdx/.markdown` so markdown opens rendered. One-line change + test update in `FilesView.test.tsx`.

- [ ] **Step 3: Run to verify pass** — `bun run test src/components/viewers/ src/lib/viewers/ src/components/auxiliarybar/FilesView.test.tsx`

- [ ] **Step 4: Commit**

```bash
git add src/components/viewers/ src/lib/viewers/index.ts src/components/auxiliarybar/FilesView.tsx src/components/auxiliarybar/FilesView.test.tsx
git commit -m "feat(viewers): promote markdown/image/video/pdf/hex previews into registry viewers"
```

---

# Workstream E — Code & Diff viewers (needs A + B + C + D)

## Task E1: `CodeViewer` — Monaco editor with save, conflict bar, watcher reload

**Files:**
- Create: `src/components/viewers/CodeViewer.tsx`
- Create: `src/components/viewers/CodeViewer.test.tsx`
- Modify: `src/lib/viewers/index.ts` (register `code`)

- [ ] **Step 1: Write failing tests** — `src/components/viewers/CodeViewer.test.tsx`:

```tsx
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkbench } from "@/state/store";
import { fileMetaForPath } from "@/lib/viewers/types";
import CodeViewer from "./CodeViewer";

const invokeMock = vi.mocked(invoke);

function tabFor(path = "/wt/src/a.ts") {
  useWorkbench.setState({ fileTabs: [], activeFileTabId: null });
  useWorkbench.getState().openFileTab({ kind: "file", path, worktreePath: "/wt", preview: false });
  return useWorkbench.getState().fileTabs[0];
}

describe("CodeViewer", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "file_read")
        return { content: "const x = 1;", size: 12, binary: false, unreadable: false, mtime: 100 };
      if (cmd === "file_write") return { mtime: 200 };
      return undefined;
    });
  });

  it("loads file content into a monaco model and mounts an editor", async () => {
    const tab = tabFor();
    render(
      <CodeViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={vi.fn()} />
    );
    const monaco = (globalThis as never as { __monaco: { editor: { create: ReturnType<typeof vi.fn> } } }).__monaco;
    await waitFor(() => expect(monaco.editor.create).toHaveBeenCalled());
    expect(invokeMock).toHaveBeenCalledWith("file_read", { filePath: "/wt/src/a.ts" });
  });

  it("registers save/copy actions; save calls file_write with expectedMtime", async () => {
    const tab = tabFor();
    let actions: { save?: () => Promise<void> } = {};
    render(
      <CodeViewer
        tab={tab}
        meta={fileMetaForPath(tab.path)}
        onDirtyChange={vi.fn()}
        registerActions={(a) => { actions = a; }}
      />
    );
    await waitFor(() => expect(actions.save).toBeDefined());
    await actions.save?.();
    expect(invokeMock).toHaveBeenCalledWith("file_write", {
      filePath: "/wt/src/a.ts",
      content: "const x = 1;",
      expectedMtime: 100,
    });
  });

  it("shows a conflict bar when file_write rejects with a conflict", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "file_read")
        return { content: "const x = 1;", size: 12, binary: false, unreadable: false, mtime: 100 };
      if (cmd === "file_write") throw new Error("file changed on disk since last read: /wt/src/a.ts");
      return undefined;
    });
    const tab = tabFor();
    let actions: { save?: () => Promise<void> } = {};
    render(
      <CodeViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={(a) => { actions = a; }} />
    );
    await waitFor(() => expect(actions.save).toBeDefined());
    await actions.save?.().catch(() => {});
    expect(await screen.findByTestId("code-viewer-conflict")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement `src/components/viewers/CodeViewer.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { getMonaco } from "@/lib/viewers/monaco/loader";
import { getOrCreateModel, releaseModel } from "@/lib/viewers/monaco/model-cache";
import { fileRead, fileWrite, onFsChanged } from "@/lib/tauri";
import type { ViewerProps } from "@/lib/viewers/types";
import { Button } from "@/components/ui/button";

export default function CodeViewer({ tab, onDirtyChange, registerActions }: ViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MonacoApi.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<MonacoApi.editor.ITextModel | null>(null);
  // The content the disk had when we last loaded/saved; dirty = model differs.
  const baselineRef = useRef("");
  const mtimeRef = useRef(0);
  const [conflict, setConflict] = useState(false);
  const reducedMotion = useReducedMotion();
  void reducedMotion; // no animations in the editor surface itself

  useEffect(() => {
    let disposed = false;
    const disposables: Array<{ dispose(): void }> = [];

    (async () => {
      const [monaco, res] = await Promise.all([getMonaco(), fileRead(tab.path)]);
      if (disposed || !hostRef.current) return;
      baselineRef.current = res.content;
      mtimeRef.current = res.mtime;
      const model = await getOrCreateModel(tab.path, res.content);
      if (disposed) {
        releaseModel(tab.path);
        return;
      }
      modelRef.current = model;
      const editor = monaco.editor.create(hostRef.current, {
        model,
        theme: "maverick-dark",
        fontFamily: "Geist Mono, monospace",
        fontSize: 12,
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        renderWhitespace: "selection",
      });
      editorRef.current = editor;

      disposables.push(
        model.onDidChangeContent(() => {
          onDirtyChange(model.getValue() !== baselineRef.current);
        })
      );

      const save = async () => {
        const content = model.getValue();
        try {
          const { mtime } = await fileWrite(tab.path, content, mtimeRef.current);
          baselineRef.current = content;
          mtimeRef.current = mtime;
          setConflict(false);
          onDirtyChange(false);
        } catch (err) {
          if (err instanceof Error && /changed on disk/i.test(err.message)) {
            setConflict(true);
            return;
          }
          throw err;
        }
      };

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void save());

      registerActions({
        save,
        copyContents: async () => {
          await navigator.clipboard.writeText(model.getValue());
        },
      });

      // External edits: reload clean tabs in place; dirty tabs get the conflict bar.
      const unlisten = await onFsChanged(({ paths }) => {
        if (!paths.includes(tab.path)) return;
        void fileRead(tab.path).then((fresh) => {
          if (fresh.mtime === mtimeRef.current) return;
          if (model.getValue() === baselineRef.current) {
            baselineRef.current = fresh.content;
            mtimeRef.current = fresh.mtime;
            model.setValue(fresh.content);
            onDirtyChange(false);
          } else {
            setConflict(true);
          }
        });
      });
      disposables.push({ dispose: unlisten });
    })();

    return () => {
      disposed = true;
      disposables.forEach((d) => d.dispose());
      editorRef.current?.dispose();
      editorRef.current = null;
      if (modelRef.current) {
        releaseModel(tab.path);
        modelRef.current = null;
      }
    };
  }, [tab.path, onDirtyChange, registerActions]);

  const reloadFromDisk = async () => {
    const fresh = await fileRead(tab.path);
    baselineRef.current = fresh.content;
    mtimeRef.current = fresh.mtime;
    modelRef.current?.setValue(fresh.content);
    setConflict(false);
    onDirtyChange(false);
  };

  const overwriteDisk = async () => {
    const content = modelRef.current?.getValue() ?? "";
    const { mtime } = await fileWrite(tab.path, content);
    baselineRef.current = content;
    mtimeRef.current = mtime;
    setConflict(false);
    onDirtyChange(false);
  };

  return (
    <div className="flex h-full w-full flex-col">
      {conflict && (
        <div
          data-testid="code-viewer-conflict"
          className="flex shrink-0 items-center gap-2 border-b border-border bg-muted px-3 py-1.5 text-[11px] text-foreground"
        >
          <span className="flex-1">File changed on disk.</span>
          <Button variant="ghost" size="sm" onClick={() => void reloadFromDisk()}>
            Reload
          </Button>
          <Button variant="destructive" size="sm" onClick={() => void overwriteDisk()}>
            Overwrite
          </Button>
        </div>
      )}
      <div ref={hostRef} data-testid="code-viewer-editor" className="min-h-0 flex-1" />
    </div>
  );
}
```

Registration appended to `src/lib/viewers/index.ts`:

```ts
viewerRegistry.register({
  id: "code",
  displayName: "Code Editor",
  priority: 10,
  capabilities: { edit: true },
  canHandle: (f, intent) => !f.binary && intent !== "diff",
  load: async () => (await import("@/components/viewers/CodeViewer")).default,
});
```

(Priority 10 < markdown/image/etc.'s 50: specialized viewers win their extensions; code wins everything else text. Markdown's Edit mode: when a markdown tab's mode is "edit", `FileTabPane`'s intent is "edit" and both markdown (50) and code (10) match — markdown still wins, so `MarkdownViewer` must render a `CodeViewer` passthrough when `tab.mode === "edit"`: add `if (tab.mode === "edit") return <CodeViewer .../>` re-exporting props — one import, lazy-safe since both live in the viewers zone. Update `MarkdownViewer.tsx` accordingly and show the View/Edit switcher for markdown by extending the `showDiffSwitch` logic in `ViewerToolbar` to also show a "View/Edit" group when `tab.kind === "file"` and the resolved descriptor has `capabilities.edit` and the file is markdown — simplest: show the mode group whenever `tab.kind === "diff"` OR `live.mode !== "diff" && candidates[0]?.id === "markdown"`, with labels View/Edit mapped to modes "view"/"edit". Add a ViewerToolbar test for the markdown case.)

- [ ] **Step 3: Run to verify pass** — `bun run test src/components/viewers/ && bun run typecheck`

- [ ] **Step 4: Commit**

```bash
git add src/components/viewers/CodeViewer.tsx src/components/viewers/CodeViewer.test.tsx src/components/viewers/MarkdownViewer.tsx src/components/viewers/ViewerToolbar.tsx src/components/viewers/ViewerToolbar.test.tsx src/lib/viewers/index.ts
git commit -m "feat(viewers): Monaco CodeViewer with save, conflict bar, fs-watch reload"
```

## Task E2: `DiffViewer` — Monaco DiffEditor with editable modified side

**Files:**
- Create: `src/components/viewers/DiffViewer.tsx`
- Create: `src/components/viewers/DiffViewer.test.tsx`
- Modify: `src/lib/viewers/index.ts` (register `diff`)

- [ ] **Step 1: Write failing tests** — `src/components/viewers/DiffViewer.test.tsx`:

```tsx
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkbench } from "@/state/store";
import { fileMetaForPath } from "@/lib/viewers/types";
import DiffViewer from "./DiffViewer";

const invokeMock = vi.mocked(invoke);

function diffTab(path = "/wt/src/a.ts") {
  useWorkbench.setState({ fileTabs: [], activeFileTabId: null });
  useWorkbench.getState().openFileTab({ kind: "diff", path, worktreePath: "/wt", preview: false });
  return useWorkbench.getState().fileTabs[0];
}

describe("DiffViewer", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "file_read")
        return { content: "new", size: 3, binary: false, unreadable: false, mtime: 100 };
      if (cmd === "file_read_at_ref") return { content: "old", missing: false };
      if (cmd === "git_discard_file") return { ok: true };
      return undefined;
    });
  });

  it("fetches HEAD content relative to the worktree and mounts a diff editor", async () => {
    const tab = diffTab();
    render(
      <DiffViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={vi.fn()} />
    );
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("file_read_at_ref", {
        worktreePath: "/wt",
        filePath: "src/a.ts",
        ref: "HEAD",
      })
    );
    const monaco = (globalThis as never as { __monaco: { editor: { createDiffEditor: ReturnType<typeof vi.fn> } } }).__monaco;
    await waitFor(() => expect(monaco.editor.createDiffEditor).toHaveBeenCalled());
  });

  it("registers discardChanges which calls git_discard_file then reloads", async () => {
    const tab = diffTab();
    let actions: { discardChanges?: () => Promise<void> } = {};
    render(
      <DiffViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={(a) => { actions = a; }} />
    );
    await waitFor(() => expect(actions.discardChanges).toBeDefined());
    await actions.discardChanges?.();
    expect(invokeMock).toHaveBeenCalledWith("git_discard_file", {
      worktreePath: "/wt",
      filePath: "src/a.ts",
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement `src/components/viewers/DiffViewer.tsx`:

```tsx
import { useEffect, useRef } from "react";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { getMonaco, ensureLanguage } from "@/lib/viewers/monaco/loader";
import { getOrCreateModel, releaseModel } from "@/lib/viewers/monaco/model-cache";
import { fileRead, fileReadAtRef, fileWrite, gitDiscardFile } from "@/lib/tauri";
import type { ViewerProps } from "@/lib/viewers/types";

function relPath(tab: { path: string; worktreePath: string }): string {
  return tab.path.startsWith(tab.worktreePath)
    ? tab.path.slice(tab.worktreePath.length).replace(/^\//, "")
    : tab.path;
}

export default function DiffViewer({ tab, onDirtyChange, registerActions }: ViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MonacoApi.editor.IStandaloneDiffEditor | null>(null);
  const originalRef = useRef<MonacoApi.editor.ITextModel | null>(null);
  const baselineRef = useRef("");
  const mtimeRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    const disposables: Array<{ dispose(): void }> = [];

    (async () => {
      const [monaco, working, head] = await Promise.all([
        getMonaco(),
        fileRead(tab.path),
        fileReadAtRef(tab.worktreePath, relPath(tab), "HEAD"),
      ]);
      if (disposed || !hostRef.current) return;
      baselineRef.current = working.content;
      mtimeRef.current = working.mtime;

      const lang = await ensureLanguage(tab.path);
      // Original side is read-only and ref-less — created fresh, disposed here.
      const original = monaco.editor.createModel(head.missing ? "" : head.content, lang);
      originalRef.current = original;
      const modified = await getOrCreateModel(tab.path, working.content);
      if (disposed) {
        original.dispose();
        releaseModel(tab.path);
        return;
      }

      const editor = monaco.editor.createDiffEditor(hostRef.current, {
        theme: "maverick-dark",
        fontFamily: "Geist Mono, monospace",
        fontSize: 12,
        automaticLayout: true,
        renderSideBySide: true,
        originalEditable: false,
        minimap: { enabled: false },
      });
      editor.setModel({ original, modified });
      editorRef.current = editor;

      disposables.push(
        modified.onDidChangeContent(() => {
          onDirtyChange(modified.getValue() !== baselineRef.current);
        })
      );

      const save = async () => {
        const content = modified.getValue();
        const { mtime } = await fileWrite(tab.path, content, mtimeRef.current);
        baselineRef.current = content;
        mtimeRef.current = mtime;
        onDirtyChange(false);
      };

      editor.getModifiedEditor().addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void save());

      registerActions({
        save,
        copyContents: async () => {
          await navigator.clipboard.writeText(modified.getValue());
        },
        discardChanges: async () => {
          await gitDiscardFile(tab.worktreePath, relPath(tab));
          const fresh = await fileRead(tab.path);
          baselineRef.current = fresh.content;
          mtimeRef.current = fresh.mtime;
          modified.setValue(fresh.content);
          onDirtyChange(false);
        },
      });
    })();

    return () => {
      disposed = true;
      disposables.forEach((d) => d.dispose());
      editorRef.current?.dispose();
      editorRef.current = null;
      originalRef.current?.dispose();
      originalRef.current = null;
      releaseModel(tab.path);
    };
  }, [tab.path, tab.worktreePath, onDirtyChange, registerActions]);

  return <div ref={hostRef} data-testid="diff-viewer-editor" className="h-full w-full" />;
}
```

Registration appended to `src/lib/viewers/index.ts`:

```ts
viewerRegistry.register({
  id: "diff",
  displayName: "Diff Viewer",
  priority: 10,
  capabilities: { edit: true, diff: true },
  canHandle: (f, intent) => !f.binary && intent === "diff",
  load: async () => (await import("@/components/viewers/DiffViewer")).default,
});
```

The Diff⟷Edit switcher already works end-to-end now: toolbar sets `tab.mode`, `FileTabPane.intentFor` flips intent between "diff" and "edit", registry resolves DiffViewer vs CodeViewer, and the shared model-cache model preserves edits across the switch.

- [ ] **Step 3: Run to verify pass** — `bun run test src/components/viewers/ && bun run typecheck`

- [ ] **Step 4: Commit**

```bash
git add src/components/viewers/DiffViewer.tsx src/components/viewers/DiffViewer.test.tsx src/lib/viewers/index.ts
git commit -m "feat(viewers): Monaco DiffViewer with live-editable modified side + undo changes"
```

## Task E3: SCM / Changes views open diff tabs

**Files:**
- Modify: `src/components/auxiliarybar/DiffView.tsx` (Changes list rows → diff tab)
- Modify: `src/components/auxiliarybar/SourceControlView.tsx` (file rows get an "open diff" affordance)
- Modify: their tests

- [ ] **Step 1: Write failing tests**

- `DiffView.test.tsx`: clicking a changed-file row calls `openFileTab` with `{ kind: "diff", path: "<worktree>/<relpath>", worktreePath, preview: true }`.
- `SourceControlView.test.tsx`: clicking the file NAME (not the checkbox area, which keeps toggling staging selection) opens a diff tab the same way. Inspect the row component at `src/components/auxiliarybar/SourceControlView.tsx:326-364` first; add a distinct clickable name span with `data-testid={`scm-open-diff-${f.path}`}` so staging clicks and diff-open clicks don't collide.

- [ ] **Step 2: Implement**

In both views the diff data rows carry worktree-RELATIVE paths (`DiffFile.path`); resolve absolute via the active workspace's `worktreePath` (both components already read the active workspace). Handler shape:

```tsx
  const openFileTab = useWorkbench((s) => s.openFileTab);
  const onOpenDiff = (relPath: string) => {
    if (!active?.worktreePath) return;
    openFileTab({
      kind: "diff",
      path: `${active.worktreePath}/${relPath}`,
      worktreePath: active.worktreePath,
      preview: true,
    });
  };
```

Wire it to the row click in `DiffView` (the `files.map` block at line ~166) and to the name span in `SourceControlView`.

- [ ] **Step 3: Run to verify pass** — `bun run test src/components/auxiliarybar/`

- [ ] **Step 4: Commit**

```bash
git add src/components/auxiliarybar/DiffView.tsx src/components/auxiliarybar/DiffView.test.tsx src/components/auxiliarybar/SourceControlView.tsx src/components/auxiliarybar/SourceControlView.test.tsx
git commit -m "feat(scm): changed-file clicks open Monaco diff tabs"
```

---

# Workstream F — Grid viewer (needs D)

## Task F1: CSV/TSV/XLSX grid viewer

**Files:**
- Create: `src/lib/viewers/grid/parse-table.ts`
- Create: `src/lib/viewers/grid/parse-table.test.ts`
- Create: `src/components/viewers/GridViewer.tsx`
- Create: `src/components/viewers/GridViewer.test.tsx`
- Modify: `src/lib/viewers/index.ts` (register `grid`)
- Modify: `package.json` (`bun add xlsx`)
- Modify: `src/test/setup.ts` (mock `xlsx`)

- [ ] **Step 1: Install + mock**

```bash
bun add xlsx
```

`src/test/setup.ts` (next to the papaparse-free mocks — papaparse runs for real, it's tiny and pure):

```ts
vi.mock("xlsx", () => ({
  read: vi.fn(() => ({
    SheetNames: ["Sheet1"],
    Sheets: { Sheet1: {} },
  })),
  utils: {
    sheet_to_json: vi.fn(() => [
      ["name", "qty"],
      ["apple", 3],
    ]),
  },
}));
```

- [ ] **Step 2: Write failing tests**

`src/lib/viewers/grid/parse-table.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseDelimited, sortRows } from "./parse-table";

describe("parseDelimited", () => {
  it("parses CSV with a header row", () => {
    const t = parseDelimited("name,qty\napple,3\nbanana,5", ",");
    expect(t.header).toEqual(["name", "qty"]);
    expect(t.rows).toEqual([["apple", "3"], ["banana", "5"]]);
  });

  it("parses TSV", () => {
    const t = parseDelimited("a\tb\n1\t2", "\t");
    expect(t.header).toEqual(["a", "b"]);
    expect(t.rows).toEqual([["1", "2"]]);
  });

  it("handles quoted fields with embedded delimiters", () => {
    const t = parseDelimited('name,note\nx,"a, b"', ",");
    expect(t.rows[0]).toEqual(["x", "a, b"]);
  });

  it("empty input yields empty table", () => {
    expect(parseDelimited("", ",")).toEqual({ header: [], rows: [] });
  });
});

describe("sortRows", () => {
  const rows = [["banana", "5"], ["apple", "3"], ["cherry", "10"]];

  it("sorts strings ascending and descending", () => {
    expect(sortRows(rows, 0, "asc")[0][0]).toBe("apple");
    expect(sortRows(rows, 0, "desc")[0][0]).toBe("cherry");
  });

  it("sorts numerically when every value is numeric", () => {
    expect(sortRows(rows, 1, "asc").map((r) => r[1])).toEqual(["3", "5", "10"]);
  });

  it("does not mutate the input", () => {
    sortRows(rows, 0, "asc");
    expect(rows[0][0]).toBe("banana");
  });
});
```

`src/components/viewers/GridViewer.test.tsx`:

```tsx
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkbench } from "@/state/store";
import { fileMetaForPath } from "@/lib/viewers/types";
import GridViewer from "./GridViewer";

const invokeMock = vi.mocked(invoke);

function tabFor(path: string) {
  useWorkbench.setState({ fileTabs: [], activeFileTabId: null });
  useWorkbench.getState().openFileTab({ kind: "file", path, worktreePath: "/wt", preview: false });
  return useWorkbench.getState().fileTabs[0];
}

describe("GridViewer", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "file_read")
        return { content: "name,qty\nbanana,5\napple,3", size: 24, binary: false, unreadable: false, mtime: 1 };
      return undefined;
    });
  });

  it("renders header and data rows from CSV", async () => {
    const tab = tabFor("/wt/data.csv");
    render(
      <GridViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={vi.fn()} />
    );
    expect(await screen.findByRole("columnheader", { name: /name/i })).toBeInTheDocument();
    expect(screen.getByText("banana")).toBeInTheDocument();
    expect(screen.getByText("apple")).toBeInTheDocument();
  });

  it("clicking a header sorts the column", async () => {
    const tab = tabFor("/wt/data.csv");
    render(
      <GridViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={vi.fn()} />
    );
    fireEvent.click(await screen.findByRole("columnheader", { name: /name/i }));
    const cells = screen.getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("apple");
  });

  it("xlsx files go through the SheetJS path", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "file_read")
        return { content: "", size: 100, binary: true, unreadable: false, mtime: 1 };
      return undefined;
    });
    const tab = tabFor("/wt/book.xlsx");
    render(
      <GridViewer tab={tab} meta={fileMetaForPath(tab.path, { binary: true })} onDirtyChange={vi.fn()} registerActions={vi.fn()} />
    );
    expect(await screen.findByRole("columnheader", { name: /name/i })).toBeInTheDocument();
    expect(screen.getByText("apple")).toBeInTheDocument();
  });
});
```

Note: the xlsx path needs raw bytes, not the text-capped `file_read`. Read binary via the asset protocol like `ImagePreview` does (`fetch(convertFileSrc(path))` → `arrayBuffer`) — check `src/panels/preview/ImagePreview.tsx`/`PDFPreview.tsx` for the existing pattern and mirror it; in tests, stub `global.fetch` to return a small ArrayBuffer.

- [ ] **Step 3: Run to verify failure**, then implement.

`src/lib/viewers/grid/parse-table.ts`:

```ts
import Papa from "papaparse";

export interface Table {
  header: string[];
  rows: string[][];
}

export function parseDelimited(content: string, delimiter: "," | "\t"): Table {
  if (!content.trim()) return { header: [], rows: [] };
  const result = Papa.parse<string[]>(content.trim(), { delimiter, skipEmptyLines: true });
  const data = result.data;
  if (data.length === 0) return { header: [], rows: [] };
  return { header: data[0].map(String), rows: data.slice(1).map((r) => r.map(String)) };
}

export type SortDir = "asc" | "desc";

export function sortRows(rows: string[][], col: number, dir: SortDir): string[][] {
  const numeric = rows.every((r) => r[col] !== "" && !Number.isNaN(Number(r[col])));
  const sorted = [...rows].sort((a, b) => {
    const cmp = numeric
      ? Number(a[col]) - Number(b[col])
      : a[col].localeCompare(b[col]);
    return dir === "asc" ? cmp : -cmp;
  });
  return sorted;
}
```

`src/components/viewers/GridViewer.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import { ArrowDown, ArrowUp } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { fileRead } from "@/lib/tauri";
import { parseDelimited, sortRows, type SortDir, type Table } from "@/lib/viewers/grid/parse-table";
import type { ViewerProps } from "@/lib/viewers/types";
import { cn } from "@/lib/utils";

const ROW_HEIGHT = 24;
const VIRTUALIZE_THRESHOLD = 50;

async function loadXlsx(path: string): Promise<Table> {
  const XLSX = await import("xlsx");
  const buf = await (await fetch(convertFileSrc(path))).arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 }) as unknown[][];
  if (data.length === 0) return { header: [], rows: [] };
  return {
    header: data[0].map(String),
    rows: data.slice(1).map((r) => r.map((c) => (c === undefined || c === null ? "" : String(c)))),
  };
}

export default function GridViewer({ tab, meta, registerActions }: ViewerProps) {
  const [table, setTable] = useState<Table>({ header: [], rows: [] });
  const [sort, setSort] = useState<{ col: number; dir: SortDir } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<Table> => {
      if (meta.ext === "xlsx") return loadXlsx(tab.path);
      const res = await fileRead(tab.path);
      const delimiter = meta.ext === "tsv" ? "\t" : ",";
      return parseDelimited(res.content, delimiter);
    };
    load().then((t) => {
      if (!cancelled) setTable(t);
    });
    return () => {
      cancelled = true;
    };
  }, [tab.path, meta.ext]);

  useEffect(() => {
    registerActions({
      copyContents: async () => {
        const text = [table.header, ...table.rows].map((r) => r.join("\t")).join("\n");
        await navigator.clipboard.writeText(text);
      },
    });
  }, [table, registerActions]);

  const rows = useMemo(
    () => (sort ? sortRows(table.rows, sort.col, sort.dir) : table.rows),
    [table.rows, sort]
  );

  const onSort = (col: number) =>
    setSort((s) =>
      s?.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" }
    );

  const gridTemplate = `repeat(${table.header.length}, minmax(120px, 1fr))`;

  const Row = ({ row }: { row: string[] }) => (
    <div role="row" className="grid border-b border-border" style={{ gridTemplateColumns: gridTemplate }}>
      {row.map((cell, i) => (
        <div role="cell" key={i} className="truncate px-2 py-1 text-[11px] text-foreground">
          {cell}
        </div>
      ))}
    </div>
  );

  return (
    <div role="table" aria-label={meta.name} className="flex h-full flex-col overflow-auto">
      <div role="row" className="sticky top-0 z-base grid border-b border-border bg-muted" style={{ gridTemplateColumns: gridTemplate }}>
        {table.header.map((h, i) => (
          <button
            key={i}
            type="button"
            role="columnheader"
            onClick={() => onSort(i)}
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-left text-[11px] font-semibold text-foreground",
              "hover:bg-foreground/5"
            )}
          >
            <span className="truncate">{h}</span>
            {sort?.col === i &&
              (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
          </button>
        ))}
      </div>
      {rows.length > VIRTUALIZE_THRESHOLD ? (
        <FixedSizeList height={600} width="100%" itemCount={rows.length} itemSize={ROW_HEIGHT}>
          {({ index, style }: ListChildComponentProps) => (
            <div style={style}>
              <Row row={rows[index]} />
            </div>
          )}
        </FixedSizeList>
      ) : (
        rows.map((row, i) => <Row key={i} row={row} />)
      )}
    </div>
  );
}
```

Registration appended to `src/lib/viewers/index.ts`:

```ts
viewerRegistry.register({
  id: "grid",
  displayName: "Table Grid",
  priority: 50,
  capabilities: {},
  canHandle: (f, intent) => ["csv", "tsv", "xlsx"].includes(f.ext) && intent !== "diff",
  load: async () => (await import("@/components/viewers/GridViewer")).default,
});
```

- [ ] **Step 4: Run to verify pass** — `bun run test src/lib/viewers/grid/ src/components/viewers/GridViewer.test.tsx src/components/viewers/builtin-viewers.test.tsx && bun run typecheck`

(Add a `grid` resolution case to `builtin-viewers.test.tsx`: `["/wt/data.csv", "preview", "grid"]`.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/viewers/grid/ src/components/viewers/GridViewer.tsx src/components/viewers/GridViewer.test.tsx src/components/viewers/builtin-viewers.test.tsx src/lib/viewers/index.ts src/test/setup.ts package.json bun.lock
git commit -m "feat(viewers): CSV/TSV/XLSX grid viewer with sort + virtualization"
```

---

# Workstream G — Final verification

## Task G1: Full-suite verification + golden path

- [ ] **Step 1: Full test matrix**

```bash
bun run typecheck
bun run test:coverage     # thresholds: lines 100 / branches 95 / functions 100
bun run test:sidecar
cd src-tauri && cargo check && cargo test && cd ..
bun run build
```

All must pass. If coverage is short, the gap list from the coverage report tells you which branch tests to add — do not lower thresholds.

- [ ] **Step 2: Golden-path manual verification** (`bun run tauri dev`)

1. Open a workspace → click a file in Files: opens an italic preview TAB in the EditorArea (no sidebar preview pane exists anymore); a second single-click on another file replaces it.
2. Double-click a file: pinned tab. Edit text → dirty dot; ⌘S saves; dot clears; reopen confirms persistence.
3. Open a `.md`: rendered view; toolbar View/Edit toggle switches to Monaco source and back, edits survive the round trip.
4. Make a change to a tracked file in the terminal → Changes view → click the file: diff tab side-by-side, original=HEAD right=working tree; Edit switcher flips to plain editor with the same buffer; Undo changes restores HEAD after the confirm dialog.
5. Open a `.png`, a `.pdf`, a `.csv` (sort a column), and a binary file (hex fallback).
6. Switch workspace tabs back and forth over an open Monaco tab — content, scroll and undo stack survive (<10ms switch, keep-alive intact).
7. Edit an open file from an external editor: clean tab reloads in place; dirty tab shows the conflict bar with Reload/Overwrite.

- [ ] **Step 3: Update docs**

- `SYSTEM-DESIGN.md`: add the viewer registry to the component map and the three new IPC commands to the command table.
- `CLAUDE.md`: add one hard rule — "**Viewers never import Monaco/pdfjs/SheetJS directly.** Always `getMonaco()` / registry `load()`. Adding a viewer must require zero changes outside `src/lib/viewers/` + `src/components/viewers/`." Add `src/lib/viewers/**`+`src/components/viewers/**` to the File Ownership zone table (owner: Editor/Terminal agent).

- [ ] **Step 4: Final commit**

```bash
git add SYSTEM-DESIGN.md CLAUDE.md
git commit -m "docs: viewer registry architecture + ownership zones"
```

---

## Plan self-review notes (resolved during writing)

- **Spec coverage:** registry (D1), FileTab+preview semantics (B1–B4), Monaco+Shiki Tier 1 (C1–C3), toolbar with breadcrumb/undo/switch/copy/open-with/viewed (D2), diff viewer with editable modified side (E2), 3 IPC commands (A1–A5), all 8 viewers (D4, E1, E2, F1, hex in D4), sidebar preview removal (B4), SCM integration (E3), perf keep-alive (B3), coverage gates (G1). Tier 2/3 are roadmap-only per spec — no tasks, correct.
- **Type consistency:** `FileTab`/`OpenFileTabInput`/`fileTabId` defined once in B1 and imported everywhere; `ViewerProps` carries `meta` (D1) and every viewer in D4/E/F uses that exact signature; `FileReadResult.mtime` added in A1/A5 and consumed in E1/E2.
- **Known judgment calls for implementers:** exact `Button`/`Dialog` prop names must be checked against `src/components/ui/` before use; the `EditorTabs` italic-class test queries `.italic` (Tailwind literal) — keep the class name; if `bun test` for vitest needs the `vitest run` alias use `bun run test` exactly as written.
