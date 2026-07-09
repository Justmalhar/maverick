# Task Composer Drag-and-Drop + Agent Icons + Attachment Launch Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make image/file drag-and-drop actually work in the Kanban Task Composer (it's currently dead because Tauri's webview swallows native HTML5 drop events), show real brand icons in the composer's agent picker, and make dropped/attached files actually reach the launched CLI agent instead of sitting inert on the task row.

**Architecture:** Two new minimal sidecar RPCs (`file.readBinary` to turn a dropped OS path into base64 content, `kanban.materializeAttachments` to write a task's attachments to disk in its worktree at launch time) plumbed through the existing Rust JSON-RPC passthrough pattern. `TaskComposer.tsx` swaps its dead native `onDrop` handlers for the existing `registerFileDropTarget` mechanism (already used by the Terminal and Agent-mode Composer) and gains brand icons + a branch-fetch fix. `KanbanBoard.tsx` materializes attachments after workspace creation and appends their paths to the launch prompt.

**Tech Stack:** TypeScript/React (Vitest + Testing Library), Bun sidecar (bun:test), Rust/Tauri v2 passthrough commands, zod schemas.

## Global Constraints

- Use `bun`, never `npm`, for any install/run commands.
- shadcn primitives + Tailwind v4 tokens only for any new UI — no hand-rolled CSS values (not needed here; no new visual elements beyond an existing icon slot).
- Every public function gets a test. Coverage thresholds are CI-enforced: lines 100%, branches 95%+, functions 100%, statements 100%.
- No comments explaining WHAT code does — only WHY, for non-obvious invariants/workarounds.
- React never reaches into `sidecar/` directly — always through a Tauri command in `src/lib/tauri.ts`.
- Rust command files are thin JSON-RPC passthroughs (`state.sidecar.request(...)`) with no business logic and, matching the existing `file_tree.rs`/`kanban.rs` pattern, no dedicated Rust unit tests for the passthrough itself — the real logic and its tests live in the sidecar.
- A task is "done" when `bun run build` + `cargo check` compile, `bun run test:coverage` and `cargo test` pass, and the feature works in `bun run tauri dev`.

---

### Task 1: `FileReader.readBinary` — read any file's bytes as base64

**Files:**
- Modify: `sidecar/file-reader.ts`
- Test: `sidecar/file-reader.test.ts`

**Interfaces:**
- Consumes: nothing new (uses `FileReader`'s existing injected `readFile`/`stat`).
- Produces: `FileReader.readBinary(params: { filePath: string }): { content: string; size: number; unreadable: boolean }` — `content` is base64, `""` when unreadable or over the 25MB safety cap; `size` is always populated when the stat succeeds (even when over-cap, so callers can show a size-based error); `unreadable: true` only on stat/read failure.

- [ ] **Step 1: Write the failing tests**

Append to `sidecar/file-reader.test.ts` (inside the existing `describe("FileReader", ...)` block, after the last test):

```ts
  test("readBinary base64-encodes arbitrary bytes", () => {
    const fr = new FileReader({
      stat: () => ({ size: 3, mtimeMs: 1 }),
      readFile: () => Buffer.from([0x00, 0x01, 0x02]),
    });
    const res = fr.readBinary({ filePath: "/a.png" });
    expect(res).toEqual({ content: Buffer.from([0x00, 0x01, 0x02]).toString("base64"), size: 3, unreadable: false });
  });

  test("readBinary reports unreadable when stat throws (missing file)", () => {
    const fr = new FileReader({
      stat: () => { throw new Error("ENOENT"); },
      readFile: () => Buffer.from([]),
    });
    const res = fr.readBinary({ filePath: "/missing.png" });
    expect(res).toEqual({ content: "", size: 0, unreadable: true });
  });

  test("readBinary reports unreadable when the read itself throws (permissions)", () => {
    const fr = new FileReader({
      stat: () => ({ size: 10, mtimeMs: 1 }),
      readFile: () => { throw new Error("EACCES"); },
    });
    const res = fr.readBinary({ filePath: "/locked.png" });
    expect(res).toEqual({ content: "", size: 10, unreadable: true });
  });

  test("readBinary refuses to slurp a file over the 25MB safety cap, but still reports size", () => {
    const fr = new FileReader({
      stat: () => ({ size: 26 * 1024 * 1024, mtimeMs: 1 }),
      readFile: () => { throw new Error("should not be called"); },
    });
    const res = fr.readBinary({ filePath: "/huge.bin" });
    expect(res).toEqual({ content: "", size: 26 * 1024 * 1024, unreadable: false });
  });

  test("readBinary round-trips a zero-byte file", () => {
    const fr = new FileReader({
      stat: () => ({ size: 0, mtimeMs: 1 }),
      readFile: () => Buffer.from([]),
    });
    const res = fr.readBinary({ filePath: "/empty.bin" });
    expect(res).toEqual({ content: "", size: 0, unreadable: false });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd sidecar && bun test file-reader.test.ts`
Expected: FAIL — `readBinary` is not a function on `FileReader`.

- [ ] **Step 3: Implement `readBinary`**

In `sidecar/file-reader.ts`, add a constant next to `MAX_TEXT_BYTES` and a new method on the `FileReader` class:

```ts
// Above this, refuse to base64-encode into memory/IPC — a defensive backstop
// against a pathological drag-drop, not the app's real attachment size limit
// (that's enforced by the caller against the `size` this returns).
const MAX_BINARY_BYTES = 25 * 1024 * 1024;
```

Add this constant right after the existing `const MAX_TEXT_BYTES = 2 * 1024 * 1024;` line. Then add the method to the `FileReader` class, right after the existing `read()` method (before the closing `}` of the class):

```ts
  /**
   * Reads `filePath` as raw bytes, base64-encoded, regardless of content type.
   * Unlike `read()` (which intentionally blanks binary content for the text
   * editor preview), this doesn't care whether the file is text — it's used
   * to turn a dropped OS file path into attachment content.
   */
  readBinary(params: { filePath: string }): { content: string; size: number; unreadable: boolean } {
    let size: number;
    try {
      size = this.stat(params.filePath).size;
    } catch {
      return { content: "", size: 0, unreadable: true };
    }
    if (size > MAX_BINARY_BYTES) {
      return { content: "", size, unreadable: false };
    }
    let buf: Buffer;
    try {
      buf = this.readFile(params.filePath);
    } catch {
      return { content: "", size, unreadable: true };
    }
    return { content: buf.toString("base64"), size, unreadable: false };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd sidecar && bun test file-reader.test.ts`
Expected: PASS, all tests including the 5 new ones.

- [ ] **Step 5: Commit**

```bash
git add sidecar/file-reader.ts sidecar/file-reader.test.ts
git commit -m "feat(sidecar): add FileReader.readBinary for base64 file reads"
```

---

### Task 2: `AttachmentMaterializer` — write kanban task attachments to disk

**Files:**
- Create: `sidecar/attachment-materializer.ts`
- Test: `sidecar/attachment-materializer.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `class AttachmentMaterializer` with `materialize(params: { worktreePath: string; taskId: string; attachments: { name: string; content: string; encoding: "utf8" | "base64" }[] }): { paths: string[] }`. Writes each attachment to `<worktreePath>/.maverick/attachments/<taskId>/<sanitized-name>` and returns the absolute paths in input order. Task 3 wires this into `RpcHandlers`.

- [ ] **Step 1: Write the failing tests**

Create `sidecar/attachment-materializer.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { AttachmentMaterializer } from "./attachment-materializer";

describe("AttachmentMaterializer", () => {
  test("writes a utf8 attachment and returns its absolute path", () => {
    const mkdirCalls: string[] = [];
    const writes: { path: string; contents: Buffer }[] = [];
    const m = new AttachmentMaterializer({
      mkdir: (p) => mkdirCalls.push(p),
      writeFile: (p, c) => writes.push({ path: p, contents: c }),
    });
    const res = m.materialize({
      worktreePath: "/wt",
      taskId: "task-1",
      attachments: [{ name: "notes.txt", content: "hello", encoding: "utf8" }],
    });
    expect(mkdirCalls).toEqual(["/wt/.maverick/attachments/task-1"]);
    expect(res.paths).toEqual(["/wt/.maverick/attachments/task-1/notes.txt"]);
    expect(writes[0].contents.toString("utf8")).toBe("hello");
  });

  test("writes a base64 attachment by decoding it to raw bytes", () => {
    const writes: { path: string; contents: Buffer }[] = [];
    const m = new AttachmentMaterializer({
      mkdir: () => {},
      writeFile: (p, c) => writes.push({ path: p, contents: c }),
    });
    const base64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    const res = m.materialize({
      worktreePath: "/wt",
      taskId: "task-1",
      attachments: [{ name: "screenshot.png", content: base64, encoding: "base64" }],
    });
    expect(res.paths).toEqual(["/wt/.maverick/attachments/task-1/screenshot.png"]);
    expect(writes[0].contents).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  test("preserves attachment order across multiple files", () => {
    const m = new AttachmentMaterializer({ mkdir: () => {}, writeFile: () => {} });
    const res = m.materialize({
      worktreePath: "/wt",
      taskId: "task-1",
      attachments: [
        { name: "a.txt", content: "a", encoding: "utf8" },
        { name: "b.png", content: "Yg==", encoding: "base64" },
      ],
    });
    expect(res.paths).toEqual([
      "/wt/.maverick/attachments/task-1/a.txt",
      "/wt/.maverick/attachments/task-1/b.png",
    ]);
  });

  test("sanitizes a name containing path traversal to a bare filename", () => {
    const m = new AttachmentMaterializer({ mkdir: () => {}, writeFile: () => {} });
    const res = m.materialize({
      worktreePath: "/wt",
      taskId: "task-1",
      attachments: [{ name: "../../etc/passwd", content: "x", encoding: "utf8" }],
    });
    expect(res.paths).toEqual(["/wt/.maverick/attachments/task-1/passwd"]);
  });

  test("sanitizes spaces and special characters in a name", () => {
    const m = new AttachmentMaterializer({ mkdir: () => {}, writeFile: () => {} });
    const res = m.materialize({
      worktreePath: "/wt",
      taskId: "task-1",
      attachments: [{ name: "my photo (1).png", content: "x", encoding: "utf8" }],
    });
    expect(res.paths).toEqual(["/wt/.maverick/attachments/task-1/my_photo__1_.png"]);
  });

  test("falls back to a generic name when sanitization empties the name", () => {
    const m = new AttachmentMaterializer({ mkdir: () => {}, writeFile: () => {} });
    const res = m.materialize({
      worktreePath: "/wt",
      taskId: "task-1",
      attachments: [{ name: "///", content: "x", encoding: "utf8" }],
    });
    expect(res.paths).toEqual(["/wt/.maverick/attachments/task-1/attachment"]);
  });

  test("returns an empty paths array for a task with no attachments", () => {
    const m = new AttachmentMaterializer({ mkdir: () => {}, writeFile: () => {} });
    const res = m.materialize({ worktreePath: "/wt", taskId: "task-1", attachments: [] });
    expect(res.paths).toEqual([]);
  });

  test("default constructor writes a real file to a real temp directory", () => {
    const { mkdtempSync, readFileSync, rmSync } = require("fs");
    const { tmpdir } = require("os");
    const { join } = require("path");
    const tmp = mkdtempSync(join(tmpdir(), "mvk-materialize-"));
    try {
      const res = new AttachmentMaterializer().materialize({
        worktreePath: tmp,
        taskId: "task-1",
        attachments: [{ name: "note.txt", content: "real content", encoding: "utf8" }],
      });
      const expectedPath = join(tmp, ".maverick", "attachments", "task-1", "note.txt");
      expect(res.paths).toEqual([expectedPath]);
      expect(readFileSync(expectedPath, "utf8")).toBe("real content");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd sidecar && bun test attachment-materializer.test.ts`
Expected: FAIL — module `./attachment-materializer` does not exist.

- [ ] **Step 3: Implement `AttachmentMaterializer`**

Create `sidecar/attachment-materializer.ts`:

```ts
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { basename, join } from "path";

export interface AttachmentInput {
  name: string;
  content: string;
  encoding: "utf8" | "base64";
}

export interface MaterializeParams {
  worktreePath: string;
  taskId: string;
  attachments: AttachmentInput[];
}

export interface MaterializeResult {
  paths: string[];
}

export interface AttachmentMaterializerOptions {
  mkdir?: (path: string) => void;
  writeFile?: (path: string, contents: Buffer) => void;
}

// Attachment names arrive from the client (paste/drop/file-picker) and are
// never trusted as path components — basename strips directory components,
// then the character allowlist blocks anything left that could still act as
// a separator, so "../../etc/passwd" can't escape the attachments directory.
function sanitizeName(name: string): string {
  const base = basename(name.replace(/\\/g, "/"));
  const cleaned = base.replace(/[^A-Za-z0-9_.-]/g, "_");
  return cleaned || "attachment";
}

export class AttachmentMaterializer {
  private mkdir: (path: string) => void;
  private writeFile: (path: string, contents: Buffer) => void;

  constructor(opts: AttachmentMaterializerOptions = {}) {
    this.mkdir =
      opts.mkdir ??
      ((p) => {
        if (!existsSync(p)) mkdirSync(p, { recursive: true });
      });
    this.writeFile = opts.writeFile ?? ((p, c) => writeFileSync(p, c));
  }

  materialize(params: MaterializeParams): MaterializeResult {
    const dir = join(params.worktreePath, ".maverick", "attachments", params.taskId);
    this.mkdir(dir);
    const paths: string[] = [];
    for (const a of params.attachments) {
      const filePath = join(dir, sanitizeName(a.name));
      const buf = a.encoding === "base64" ? Buffer.from(a.content, "base64") : Buffer.from(a.content, "utf8");
      this.writeFile(filePath, buf);
      paths.push(filePath);
    }
    return { paths };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd sidecar && bun test attachment-materializer.test.ts`
Expected: PASS, all 8 tests.

Note: the sanitize test for `"///"` — after `basename("///".replace(/\\/g,"/"))` you get `""`, `cleaned` is `""`, so it falls back to `"attachment"`. Verify this matches; if `basename("///")` behaves differently on your Node version, adjust `sanitizeName` so the empty-after-basename case still falls through to the `"attachment"` fallback (the `|| "attachment"` already covers `""`).

- [ ] **Step 5: Commit**

```bash
git add sidecar/attachment-materializer.ts sidecar/attachment-materializer.test.ts
git commit -m "feat(sidecar): add AttachmentMaterializer to write task attachments to a worktree"
```

---

### Task 3: Wire both into `RpcHandlers` (`file.readBinary`, `kanban.materializeAttachments`)

**Files:**
- Modify: `sidecar/rpc-handlers.ts`
- Test: `sidecar/rpc-handlers.test.ts`

**Interfaces:**
- Consumes: `FileReader.readBinary` (Task 1), `AttachmentMaterializer` (Task 2).
- Produces: RPC methods `"file.readBinary"` and `"kanban.materializeAttachments"` dispatchable via `RpcHandlers.dispatch(method, params)`. Task 4 (Rust) forwards to these by name.

- [ ] **Step 1: Write the failing tests**

Add to `sidecar/rpc-handlers.test.ts`, right after the existing `test("file.read delegates to FileReader", ...)` block (around line 393):

```ts
  test("file.readBinary delegates to FileReader", async () => {
    const store = new SQLiteStore({ path: ":memory:", migrationsDir: defaultMigrationsDir() });
    const fileReader = {
      readBinary: (p: { filePath: string }) => ({
        content: `b64:${p.filePath}`,
        size: 4,
        unreadable: false,
      }),
    } as never;
    const handlers = new RpcHandlers({ store, fileReader, notifier: { write: () => {} } });
    const res = (await handlers.dispatch("file.readBinary", { filePath: "/wt/a.png" })) as {
      content: string;
    };
    expect(res.content).toBe("b64:/wt/a.png");
  });
```

Then, near the existing kanban tests (search for `"kanban.upsert"` in the test file and add right after that block):

```ts
  test("kanban.materializeAttachments delegates to AttachmentMaterializer", async () => {
    const store = new SQLiteStore({ path: ":memory:", migrationsDir: defaultMigrationsDir() });
    let received: unknown;
    const attachmentMaterializer = {
      materialize: (p: unknown) => {
        received = p;
        return { paths: ["/wt/.maverick/attachments/task-1/a.png"] };
      },
    } as never;
    const handlers = new RpcHandlers({ store, attachmentMaterializer, notifier: { write: () => {} } });
    const res = (await handlers.dispatch("kanban.materializeAttachments", {
      worktreePath: "/wt",
      taskId: "task-1",
      attachments: [{ name: "a.png", content: "AA==", encoding: "base64" }],
    })) as { paths: string[] };
    expect(res.paths).toEqual(["/wt/.maverick/attachments/task-1/a.png"]);
    expect(received).toEqual({
      worktreePath: "/wt",
      taskId: "task-1",
      attachments: [{ name: "a.png", content: "AA==", encoding: "base64" }],
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd sidecar && bun test rpc-handlers.test.ts -t "readBinary|materializeAttachments"`
Expected: FAIL — unknown RPC method / `attachmentMaterializer` option not recognized (TypeScript will also flag the option if you run `tsc`, but `bun test` erases types, so the failure here is a runtime "unknown method" error from `dispatch`).

- [ ] **Step 3: Wire the schemas, options, and dispatch cases**

In `sidecar/rpc-handlers.ts`, add the import near the other sidecar module imports (after `import { AttachmentStore } from "./attachment-store";`):

```ts
import { AttachmentMaterializer } from "./attachment-materializer";
```

Add two schemas to the `Schemas` object, right after the existing `fileRead: z.object({ filePath: z.string() }),` line:

```ts
  fileReadBinary: z.object({ filePath: z.string() }),
```

And right after the `kanbanUpsert: z.object({...}),` block (before `kanbanDelete`), add:

```ts
  kanbanMaterializeAttachments: z.object({
    worktreePath: z.string(),
    taskId: z.string(),
    attachments: z.array(
      z.object({
        name: z.string(),
        content: z.string(),
        encoding: z.enum(["utf8", "base64"]),
      })
    ),
  }),
```

Add the option and field to `RpcHandlersOptions` and `RpcHandlers` (right after the existing `attachments?: AttachmentStore;` / `readonly attachments: AttachmentStore;` lines):

```ts
  attachmentMaterializer?: AttachmentMaterializer;
```

```ts
  readonly attachmentMaterializer: AttachmentMaterializer;
```

Initialize it in the constructor, right after `this.attachments = opts.attachments ?? new AttachmentStore();`:

```ts
    this.attachmentMaterializer = opts.attachmentMaterializer ?? new AttachmentMaterializer();
```

Add the dispatch case for `file.readBinary` right after the existing `case "file.read":` block:

```ts
      case "file.readBinary": {
        const p = Schemas.fileReadBinary.parse(params);
        return this.fileReader.readBinary(p);
      }
```

Add the dispatch case for `kanban.materializeAttachments` right after the existing `case "kanban.upsert":` block:

```ts
      case "kanban.materializeAttachments": {
        const p = Schemas.kanbanMaterializeAttachments.parse(params);
        return this.attachmentMaterializer.materialize(p);
      }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd sidecar && bun test rpc-handlers.test.ts`
Expected: PASS, full file green (this file has many pre-existing tests — confirm none regressed).

- [ ] **Step 5: Commit**

```bash
git add sidecar/rpc-handlers.ts sidecar/rpc-handlers.test.ts
git commit -m "feat(sidecar): expose file.readBinary and kanban.materializeAttachments RPCs"
```

---

### Task 4: Rust passthrough commands

**Files:**
- Modify: `src-tauri/src/commands/file_tree.rs`
- Modify: `src-tauri/src/commands/kanban.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: sidecar RPC methods `"file.readBinary"` and `"kanban.materializeAttachments"` (Task 3).
- Produces: Tauri commands `file_read_binary(file_path: String)` and `kanban_materialize_attachments(worktree_path: String, task_id: String, attachments: Value)`, both returning `Result<Value, String>`. Task 5 calls these by name from `src/lib/tauri.ts`.

No dedicated Rust test — matches the existing untested-passthrough pattern for every other command in `file_tree.rs` and `kanban.rs`. Verified instead by `cargo check` and, end-to-end, by the frontend tests in later tasks (which mock at the `invoke` boundary) plus manual verification in `bun run tauri dev`.

- [ ] **Step 1: Add `file_read_binary` to `file_tree.rs`**

In `src-tauri/src/commands/file_tree.rs`, add this right after the existing `file_read` function (after its closing `}`, before `file_write`):

```rust
#[tauri::command]
pub async fn file_read_binary(state: State<'_, AppState>, file_path: String) -> Result<Value, String> {
    state
        .sidecar
        .request("file.readBinary", json!({ "filePath": file_path }))
        .await
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Add `kanban_materialize_attachments` to `kanban.rs`**

In `src-tauri/src/commands/kanban.rs`, add this right after the existing `kanban_upsert` function (after its closing `}`, before `kanban_delete`):

```rust
#[tauri::command]
pub async fn kanban_materialize_attachments(
    state: State<'_, AppState>,
    worktree_path: String,
    task_id: String,
    attachments: Value,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "kanban.materializeAttachments",
            json!({ "worktreePath": worktree_path, "taskId": task_id, "attachments": attachments }),
        )
        .await
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Export both from `mod.rs`**

In `src-tauri/src/commands/mod.rs`, change:

```rust
pub use file_tree::{
    file_read, file_search, file_tree, file_write, fs_watch_add, fs_watch_remove, fs_watch_start,
    fs_watch_stop,
};
```

to:

```rust
pub use file_tree::{
    file_read, file_read_binary, file_search, file_tree, file_write, fs_watch_add,
    fs_watch_remove, fs_watch_start, fs_watch_stop,
};
```

And change:

```rust
pub use kanban::{kanban_delete, kanban_list, kanban_upsert};
```

to:

```rust
pub use kanban::{kanban_delete, kanban_list, kanban_materialize_attachments, kanban_upsert};
```

- [ ] **Step 4: Register both commands in `lib.rs`**

In `src-tauri/src/lib.rs`, inside the `tauri::generate_handler![...]` list, change:

```rust
            file_tree,
            file_read,
            file_write,
```

to:

```rust
            file_tree,
            file_read,
            file_read_binary,
            file_write,
```

And change:

```rust
            kanban_list,
            kanban_upsert,
            kanban_delete,
```

to:

```rust
            kanban_list,
            kanban_upsert,
            kanban_delete,
            kanban_materialize_attachments,
```

- [ ] **Step 5: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles with no new errors (pre-existing `resolve_bun` Windows-literal test failures on macOS, per prior audit, are unrelated and may still show if you run `cargo test` instead of `cargo check` — `cargo check` alone doesn't run tests).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/file_tree.rs src-tauri/src/commands/kanban.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(rust): register file_read_binary and kanban_materialize_attachments passthroughs"
```

---

### Task 5: Frontend IPC types + `tauri.ts` wrappers

**Files:**
- Modify: `src/lib/ipc.ts`
- Modify: `src/lib/tauri.ts`
- Test: `src/lib/tauri.test.ts`

**Interfaces:**
- Consumes: Tauri commands `file_read_binary`, `kanban_materialize_attachments` (Task 4).
- Produces: `interface FileReadBinaryResult { content: string; size: number; unreadable: boolean }`; `async function fileReadBinary(filePath: string): Promise<FileReadBinaryResult>`; `async function kanbanMaterializeAttachments(worktreePath: string, taskId: string, attachments: Attachment[]): Promise<{ paths: string[] }>`. Tasks 7 and 8 call these.

- [ ] **Step 1: Write the failing tests**

In `src/lib/tauri.test.ts`, find the existing test `it("file read / search and fs watch wrappers", ...)` (around line 165) and add these lines right after the `api.fileRead` assertion, still inside that same `it` block:

```ts
    await api.fileReadBinary("/wt/img.png");
    expect(invoke).toHaveBeenLastCalledWith("file_read_binary", { filePath: "/wt/img.png" });
```

Then add a new, separate test right after that `it` block closes:

```ts
  it("kanbanMaterializeAttachments wrapper", async () => {
    const attachments = [{ name: "a.png", content: "AA==", encoding: "base64" as const, size: 1 }];
    await api.kanbanMaterializeAttachments("/wt", "task-1", attachments);
    expect(invoke).toHaveBeenLastCalledWith("kanban_materialize_attachments", {
      worktreePath: "/wt",
      taskId: "task-1",
      attachments,
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run vitest run src/lib/tauri.test.ts`
Expected: FAIL — `api.fileReadBinary` and `api.kanbanMaterializeAttachments` are not functions.

- [ ] **Step 3: Add the type and wrapper functions**

In `src/lib/ipc.ts`, add this interface right after the existing `FileReadResult` interface (after its closing `}`, before `FileWriteResult`):

```ts
export interface FileReadBinaryResult {
  content: string;
  size: number;
  unreadable: boolean;
}
```

In `src/lib/tauri.ts`, the top-of-file `import type { ... } from "@/lib/ipc";` block does not currently import `Attachment` or `FileReadBinaryResult` by name (it only imports `KanbanTask`, `FileReadResult`, etc., which reference `Attachment` internally without requiring it here). Add both names to that existing import block: insert `Attachment` right after `AgentSessionSnapshot` (alphabetically, before `BlameLine`), and insert `FileReadBinaryResult` right after `FileEntry` (alphabetically, before `FileReadResult`).

Then add the wrapper function right after the existing `fileRead` function:

```ts
export async function fileReadBinary(filePath: string): Promise<FileReadBinaryResult> {
  return invoke("file_read_binary", { filePath });
}
```

Add `kanbanMaterializeAttachments` right after the existing `kanbanUpsert` function:

```ts
export async function kanbanMaterializeAttachments(
  worktreePath: string,
  taskId: string,
  attachments: Attachment[]
): Promise<{ paths: string[] }> {
  return invoke("kanban_materialize_attachments", { worktreePath, taskId, attachments });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run vitest run src/lib/tauri.test.ts`
Expected: PASS, full file green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ipc.ts src/lib/tauri.ts src/lib/tauri.test.ts
git commit -m "feat(frontend): add fileReadBinary and kanbanMaterializeAttachments wrappers"
```

---

### Task 6: `appendAttachments` prompt helper

**Files:**
- Modify: `src/lib/agent-prompt.ts`
- Test: `src/lib/agent-prompt.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `function appendAttachments(prompt: string, paths: string[]): string`. Task 8 calls this.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/agent-prompt.test.ts`, after the existing `describe("buildLaunchPrompt", ...)` block:

```ts
describe("appendAttachments", () => {
  it("returns the prompt unchanged when there are no attachment paths", () => {
    expect(appendAttachments("fix the bug", [])).toBe("fix the bug");
  });

  it("appends a single attachment path as a labeled block", () => {
    expect(appendAttachments("fix the bug", ["/wt/.maverick/attachments/t1/screenshot.png"])).toBe(
      "fix the bug\n\n[Attached files]\n- /wt/.maverick/attachments/t1/screenshot.png"
    );
  });

  it("appends multiple attachment paths, one per line", () => {
    expect(
      appendAttachments("fix the bug", [
        "/wt/.maverick/attachments/t1/a.png",
        "/wt/.maverick/attachments/t1/b.txt",
      ])
    ).toBe(
      "fix the bug\n\n[Attached files]\n- /wt/.maverick/attachments/t1/a.png\n- /wt/.maverick/attachments/t1/b.txt"
    );
  });
});
```

Also update the import line at the top of `src/lib/agent-prompt.test.ts` from:

```ts
import { formatPreferences, buildLaunchPrompt } from "./agent-prompt";
```

to:

```ts
import { formatPreferences, buildLaunchPrompt, appendAttachments } from "./agent-prompt";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run vitest run src/lib/agent-prompt.test.ts`
Expected: FAIL — `appendAttachments` is not exported from `./agent-prompt`.

- [ ] **Step 3: Implement `appendAttachments`**

In `src/lib/agent-prompt.ts`, add this function right after `buildLaunchPrompt`:

```ts
export function appendAttachments(prompt: string, paths: string[]): string {
  if (paths.length === 0) return prompt;
  return `${prompt}\n\n[Attached files]\n${paths.map((p) => `- ${p}`).join("\n")}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run vitest run src/lib/agent-prompt.test.ts`
Expected: PASS, all tests including the 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-prompt.ts src/lib/agent-prompt.test.ts
git commit -m "feat(frontend): add appendAttachments launch-prompt helper"
```

---

### Task 7: `TaskComposer.tsx` — brand icons on the agent picker

**Files:**
- Modify: `src/panels/kanban/TaskComposer.tsx`
- Test: `src/panels/kanban/TaskComposer.test.tsx`

**Interfaces:**
- Consumes: `brandFor` from `@/lib/backend-brand` (existing).
- Produces: no new exports; visual/DOM change only (backend `<SelectItem>` now renders a brand icon before the label).

- [ ] **Step 1: Write the failing test**

Add to `src/panels/kanban/TaskComposer.test.tsx`, after the existing `it("renders attachment button and hidden file input", ...)` test:

```ts
  it("shows the backend's brand icon in the agent picker", async () => {
    setup();
    await userEvent.click(screen.getByTestId("composer-agent"));
    expect(await screen.findByTestId("icon-ClaudeCode.Color")).toBeInTheDocument();
  });
```

This relies on the `setup()` fixture's `backends: [makeBackend({ id: "claude", name: "Claude", active: true })]` (line 16) — `"claude"` isn't a recognized key in `BACKEND_BRAND` (the known ids are `"claude-code"`, `"codex"`, `"gemini"`, `"aider"`, `"opencode"`, `"antigravity"`, `"ollama"`), so the icon test needs a real match. Change **only** that one line, inside `setup()`, from `id: "claude"` to `id: "claude-code"`. Do not touch the three other, unrelated inline `useWorkbench.setState` calls further down the file (in the `defaultProjectId` tests, around lines 283/299/313) — they don't exercise the icon and don't need this id.

This one-line change ripples into exactly one other spot: the test `it("onSend called with correct payload and composer resets", ...)` also uses `setup()` and asserts `agentBackend: "claude"` (around line 187) on the payload `onSend` receives — since that payload's `agentBackend` is just an echo of the selected backend's id, update that single assertion to `agentBackend: "claude-code"` too. Search the file for `"claude"` as a bare string (`grep -n '"claude"' src/panels/kanban/TaskComposer.test.tsx`) and confirm exactly these two spots (line 16 and line 187) are the only ones that need to change — everything else at lines 283/299/313 stays as `"claude"` and is unaffected.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run vitest run src/panels/kanban/TaskComposer.test.tsx -t "brand icon"`
Expected: FAIL — no element with `data-testid="icon-ClaudeCode.Color"` is rendered.

- [ ] **Step 3: Add the icon**

In `src/panels/kanban/TaskComposer.tsx`, add the import:

```ts
import { brandFor } from "@/lib/backend-brand";
```

Change the backend `<Select>` block (currently):

```tsx
        <Select value={selectedBackendId} onValueChange={setSelectedBackendId}>
          <SelectTrigger className="h-7 w-32 border-border/50 text-[11px]" data-testid="composer-agent">
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
```

to:

```tsx
        <Select value={selectedBackendId} onValueChange={setSelectedBackendId}>
          <SelectTrigger className="h-7 w-32 border-border/50 text-[11px]" data-testid="composer-agent">
            <SelectValue placeholder="Agent" />
          </SelectTrigger>
          <SelectContent>
            {backends.map((b) => {
              const brand = brandFor(b.id);
              const BrandIcon = brand?.Icon;
              return (
                <SelectItem key={b.id} value={b.id} className="text-[11px]">
                  <span className="flex items-center gap-2">
                    {BrandIcon ? <BrandIcon size={14} /> : null}
                    {brand?.label ?? b.name}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
```

- [ ] **Step 4: Run the full test file to verify everything passes**

Run: `bun run vitest run src/panels/kanban/TaskComposer.test.tsx`
Expected: PASS, full file green (double-check the `"claude"` → `"claude-code"` id rename from Step 1 didn't break any other assertion in this file).

- [ ] **Step 5: Commit**

```bash
git add src/panels/kanban/TaskComposer.tsx src/panels/kanban/TaskComposer.test.tsx
git commit -m "fix(kanban): show brand icons in the Task Composer agent picker"
```

---

### Task 8: `TaskComposer.tsx` — fix the missing initial branch fetch

**Files:**
- Modify: `src/panels/kanban/TaskComposer.tsx`
- Test: `src/panels/kanban/TaskComposer.test.tsx`

**Interfaces:**
- Consumes: existing `fetchBranches`, `activeWorkspace`.
- Produces: no new exports; on mount, if there's no `defaultProjectId` prop but `selectedProjectId` already has a value from `activeWorkspace`, branches get fetched for it.

- [ ] **Step 1: Write the failing test**

Add to `src/panels/kanban/TaskComposer.test.tsx`, after the existing `it("defaultProjectId null does not auto-populate project", ...)` test:

```ts
  it("fetches branches on mount from the active workspace's project when no defaultProjectId prop is given", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(["main", "dev"] as never);
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", name: "Alpha", path: "/alpha" })],
      backends: [makeBackend({ id: "claude-code", name: "Claude", active: true })],
      workspaces: [makeWorkspace({ id: "ws1", projectId: "p1" })],
      activeWorkspaceId: "ws1",
    });
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<TaskComposer onSend={onSend} />);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("git_branches", { projectPath: "/alpha" }));
    await waitFor(() => expect(screen.getByTestId("composer-branch")).toHaveTextContent("main"));
  });
```

Add `makeWorkspace` to the existing fixtures import at the top of the file:

```ts
import { makeBackend, makeProject, makeWorkspace } from "@/test/fixtures";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run vitest run src/panels/kanban/TaskComposer.test.tsx -t "fetches branches on mount"`
Expected: FAIL — `git_branches` is never called; `composer-branch` stays on its placeholder.

- [ ] **Step 3: Fix the effect**

In `src/panels/kanban/TaskComposer.tsx`, the current effect reads:

```tsx
  useEffect(() => {
    if (!defaultProjectId) return;
    setSelectedProjectId(defaultProjectId);
    fetchBranches(defaultProjectId);
  }, [defaultProjectId, fetchBranches]);
```

Leave that effect exactly as-is (it still owns the `defaultProjectId`-prop-driven case, including re-fetching when the prop changes), and add a second, mount-only effect right after it:

```tsx
  // Mount-only: when there's no `defaultProjectId` prop but `selectedProjectId`
  // already has a value from `activeWorkspace` (see the useState initializer
  // above), the effect above never runs for it and the base-branch select
  // would silently stay empty forever, blocking `canSend`.
  useEffect(() => {
    if (defaultProjectId) return;
    if (!selectedProjectId) return;
    fetchBranches(selectedProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 4: Run the full test file to verify everything passes**

Run: `bun run vitest run src/panels/kanban/TaskComposer.test.tsx`
Expected: PASS, full file green — in particular re-verify `it("defaultProjectId null does not auto-populate project", ...)` still passes (it doesn't set `activeWorkspace`/`workspaces`, so `selectedProjectId` stays `""` and the new effect's `if (!selectedProjectId) return;` guard keeps it a no-op).

- [ ] **Step 5: Commit**

```bash
git add src/panels/kanban/TaskComposer.tsx src/panels/kanban/TaskComposer.test.tsx
git commit -m "fix(kanban): fetch branches on mount when the composer defaults from the active workspace"
```

---

### Task 9: `TaskComposer.tsx` — fix the `btoa` stack overflow in the file-picker path

**Files:**
- Modify: `src/panels/kanban/TaskComposer.tsx`
- Test: `src/panels/kanban/TaskComposer.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `processFiles`'s binary branch no longer crashes on files over ~100KB. No new exports.

- [ ] **Step 1: Write the failing test**

Add to `src/panels/kanban/TaskComposer.test.tsx`, after the existing `it("file selection via input creates base64 attachment for binary file", ...)` test:

```ts
  it("file selection with a large binary file does not stack-overflow (regression)", async () => {
    setup();
    const fileInput = screen.getByTestId("composer-file-input");
    const bytes = new Uint8Array(150_000).fill(7);
    const mockFile = new File([bytes], "big-image.png", { type: "image/png" });
    await userEvent.upload(fileInput, mockFile);
    await waitFor(() => expect(screen.getByTestId("composer-attachment")).toBeInTheDocument());
    expect(screen.getByTestId("composer-attachment").textContent).toContain("big-image.png");
    expect(screen.queryByTestId("composer-error")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run vitest run src/panels/kanban/TaskComposer.test.tsx -t "stack-overflow"`
Expected: FAIL — `RangeError: Maximum call stack size exceeded` (or similar) thrown from the `btoa(String.fromCharCode(...))` spread inside `processFiles`, surfacing as an unhandled rejection / test failure rather than a clean attachment render.

- [ ] **Step 3: Fix the encoder**

In `src/panels/kanban/TaskComposer.tsx`, add this helper function above the `TaskComposer` component (right after the `pickDefaultBranch` function, before the `Props` interface):

```ts
// btoa(String.fromCharCode(...bytes)) spreads the whole array as call
// arguments and stack-overflows past a few hundred KB. Chunking keeps every
// spread call small regardless of file size.
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
```

Change this line inside `processFiles`:

```ts
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
```

to:

```ts
        const base64 = arrayBufferToBase64(buffer);
```

- [ ] **Step 4: Run the full test file to verify everything passes**

Run: `bun run vitest run src/panels/kanban/TaskComposer.test.tsx`
Expected: PASS, full file green.

- [ ] **Step 5: Commit**

```bash
git add src/panels/kanban/TaskComposer.tsx src/panels/kanban/TaskComposer.test.tsx
git commit -m "fix(kanban): chunk base64 encoding to stop a stack overflow on large file attachments"
```

---

### Task 10: `TaskComposer.tsx` — real drag-and-drop via `registerFileDropTarget`

This is the core fix. It replaces the dead native HTML5 drop handlers and their now-obsolete tests.

**Files:**
- Modify: `src/panels/kanban/TaskComposer.tsx`
- Test: `src/panels/kanban/TaskComposer.test.tsx`

**Interfaces:**
- Consumes: `registerFileDropTarget` from `@/lib/file-drop` (existing), `fileReadBinary` from `@/lib/tauri` (Task 5).
- Produces: no new exports; the composer root becomes a registered file-drop target and dropped OS paths become attachments. `attachments` state, `error` state, and `isDraggingOver` state keep their existing shapes and are consumed unchanged by Task 8's helper (n/a) and the render below them.

- [ ] **Step 1: Write the failing tests, and remove the tests for the behavior being replaced**

First, remove these five now-obsolete tests from `src/panels/kanban/TaskComposer.test.tsx` — they simulate native DOM `dragover`/`dragleave`/`drop` events directly on the composer, which is exactly the dead code path this task deletes:

- `it("dragOver adds ring style to composer", ...)`
- `it("dragLeave removes ring style from composer", ...)`
- `it("drop with text file creates a utf8 attachment", ...)`
- `it("drop with binary file creates a base64 attachment", ...)`
- `it("drop with oversized file shows error and no attachment", ...)`

Also remove `it("renders drag-over overlay when dragging files over the composer", ...)` (it uses `fireEvent.dragOver`, same dead path) — it gets replaced below.

Add the module mock near the top of the file, right after the existing `vi.mock`-free imports (there are none currently in this file, so add it right after the last `import` line, before `const initial = useWorkbench.getState();`):

```ts
import { registerFileDropTarget } from "@/lib/file-drop";

vi.mock("@/lib/file-drop", () => ({ registerFileDropTarget: vi.fn().mockReturnValue(() => {}) }));
```

Now add the replacement tests, in the same place the removed tests were (after the `it("renders attachment button and hidden file input", ...)` test, i.e. right before the new tests from Tasks 7–9 — order among new tests doesn't matter, just keep them all inside the `describe` block):

```ts
  it("registers the composer as a file-drop target", () => {
    setup();
    expect(registerFileDropTarget).toHaveBeenCalledWith(
      screen.getByTestId("task-composer"),
      expect.objectContaining({ onPaths: expect.any(Function), onDragState: expect.any(Function) })
    );
  });

  it("shows the drag-over overlay while a file is dragged over, via onDragState", () => {
    setup();
    const call = vi.mocked(registerFileDropTarget).mock.calls[0];
    act(() => call[1].onDragState?.(true));
    expect(screen.getByText("Drop files here to attach")).toBeInTheDocument();
    act(() => call[1].onDragState?.(false));
    expect(screen.queryByText("Drop files here to attach")).not.toBeInTheDocument();
  });

  it("dropping a readable path adds a base64 attachment", async () => {
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === "file_read_binary") return { content: "aGVsbG8=", size: 5, unreadable: false };
      return undefined;
    }) as unknown as typeof invoke);
    setup();
    const call = vi.mocked(registerFileDropTarget).mock.calls[0];
    await act(async () => call[1].onPaths(["/Users/me/Desktop/screenshot.png"]));
    await waitFor(() => expect(screen.getByTestId("composer-attachment")).toBeInTheDocument());
    expect(screen.getByTestId("composer-attachment").textContent).toContain("screenshot.png");
    expect(invoke).toHaveBeenCalledWith("file_read_binary", { filePath: "/Users/me/Desktop/screenshot.png" });
  });

  it("dropping an oversized path shows an error and adds no attachment", async () => {
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === "file_read_binary")
        return { content: "", size: 3 * 1024 * 1024, unreadable: false };
      return undefined;
    }) as unknown as typeof invoke);
    setup();
    const call = vi.mocked(registerFileDropTarget).mock.calls[0];
    await act(async () => call[1].onPaths(["/tmp/huge.bin"]));
    await waitFor(() => expect(screen.getByTestId("composer-error")).toBeInTheDocument());
    expect(screen.getByTestId("composer-error").textContent).toContain("too large");
    expect(screen.queryByTestId("composer-attachment")).not.toBeInTheDocument();
  });

  it("dropping an unreadable path shows an error and adds no attachment", async () => {
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === "file_read_binary") return { content: "", size: 0, unreadable: true };
      return undefined;
    }) as unknown as typeof invoke);
    setup();
    const call = vi.mocked(registerFileDropTarget).mock.calls[0];
    await act(async () => call[1].onPaths(["/tmp/gone.png"]));
    await waitFor(() => expect(screen.getByTestId("composer-error")).toBeInTheDocument());
    expect(screen.queryByTestId("composer-attachment")).not.toBeInTheDocument();
  });

  it("dropping multiple paths adds one attachment per readable file", async () => {
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === "file_read_binary") return { content: "AA==", size: 1, unreadable: false };
      return undefined;
    }) as unknown as typeof invoke);
    setup();
    const call = vi.mocked(registerFileDropTarget).mock.calls[0];
    await act(async () => call[1].onPaths(["/tmp/a.png", "/tmp/b.png"]));
    await waitFor(() => expect(screen.getAllByTestId("composer-attachment")).toHaveLength(2));
  });
```

Add `act` to the existing `import { fireEvent, act, createEvent } from "@testing-library/react";` line if it isn't already there (it already is, per the current file — no change needed) and remove `createEvent` from that import if it's no longer used anywhere else in the file after deleting the tests above (check with `grep -n "createEvent" src/panels/kanban/TaskComposer.test.tsx` — if the only remaining uses were in the deleted tests, drop `createEvent` from the import to avoid an unused-import lint failure).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run vitest run src/panels/kanban/TaskComposer.test.tsx`
Expected: FAIL — `registerFileDropTarget` is never called (the component doesn't use it yet); the new drop-path tests fail because `onPaths` is never invoked by production code.

- [ ] **Step 3: Rewire the component**

In `src/panels/kanban/TaskComposer.tsx`:

Change the import line:

```ts
import { useState, useCallback, useEffect } from "react";
```

to:

```ts
import { useState, useCallback, useEffect, useRef } from "react";
```

Add these two imports alongside the existing ones:

```ts
import { registerFileDropTarget } from "@/lib/file-drop";
```

And add `fileReadBinary` to the existing `@/lib/tauri` import (currently `import { gitBranches, projectSettingsGet } from "@/lib/tauri";`), making it:

```ts
import { fileReadBinary, gitBranches, projectSettingsGet } from "@/lib/tauri";
```

Add a ref, right after the `const [isDraggingOver, setIsDraggingOver] = useState(false);` line:

```ts
  const rootRef = useRef<HTMLDivElement>(null);
```

Add `processPaths`, right after the existing `processFiles` function:

```ts
  const processPaths = useCallback(async (paths: string[]) => {
    setError(null);
    for (const path of paths) {
      const name = path.split(/[/\\]/).pop() ?? path;
      let result: Awaited<ReturnType<typeof fileReadBinary>>;
      try {
        result = await fileReadBinary(path);
      } catch {
        setError(`Could not read file: ${name}`);
        continue;
      }
      if (result.unreadable) {
        setError(`Could not read file: ${name}`);
        continue;
      }
      if (result.size > 2 * 1024 * 1024) {
        setError(`File too large (max 2 MB): ${name}`);
        continue;
      }
      setAttachments((prev) => [
        ...prev,
        { name, content: result.content, encoding: "base64", size: result.size },
      ]);
    }
  }, []);
```

Remove the now-unused native drop handlers — delete these three functions entirely:

```ts
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files) {
      await processFiles(e.dataTransfer.files);
    }
  };
```

(Keep `handleFileChange` — it drives the unaffected `<input type=file>` picker.)

Add the drop-target registration effect, right after the `fetchBranches` and mount effects (i.e. right after Task 8's new mount-only effect, before `handleProjectChange`):

```ts
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    return registerFileDropTarget(el, { onPaths: processPaths, onDragState: setIsDraggingOver });
  }, [processPaths]);
```

Finally, update the root `<div>` in the JSX: attach `rootRef` and remove the now-dead `onDragOver`/`onDragLeave`/`onDrop` props. Change:

```tsx
    <div
      data-testid="task-composer"
      className={cn(
        "border-b border-border/60 bg-card/30 px-4 py-3 relative",
        isDraggingOver && "ring-1 ring-inset ring-primary"
      )}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDrop}
    >
```

to:

```tsx
    <div
      ref={rootRef}
      data-testid="task-composer"
      className={cn(
        "border-b border-border/60 bg-card/30 px-4 py-3 relative",
        isDraggingOver && "ring-1 ring-inset ring-primary"
      )}
    >
```

- [ ] **Step 4: Run the full test file to verify everything passes**

Run: `bun run vitest run src/panels/kanban/TaskComposer.test.tsx`
Expected: PASS, full file green.

- [ ] **Step 5: Run the whole frontend suite to check for regressions**

Run: `bun run vitest run`
Expected: PASS. In particular, no other test file references `TaskComposer`'s removed `handleDragOver`/`handleDrop` (they were private to the component, not exported, so this should be a non-issue — confirm with `grep -rn "handleDragOver\|handleDrop" src/` returning only the file you just edited, or nothing).

- [ ] **Step 6: Commit**

```bash
git add src/panels/kanban/TaskComposer.tsx src/panels/kanban/TaskComposer.test.tsx
git commit -m "fix(kanban): drag-and-drop attach via registerFileDropTarget (Tauri swallows native drop events)"
```

---

### Task 11: `KanbanBoard.tsx` — materialize attachments and forward them to the launched agent

**Files:**
- Modify: `src/panels/kanban/KanbanBoard.tsx`
- Test: `src/panels/kanban/KanbanBoard.test.tsx`

**Interfaces:**
- Consumes: `kanbanMaterializeAttachments` from `@/lib/tauri` (Task 5), `appendAttachments` from `@/lib/agent-prompt` (Task 6).
- Produces: no new exports; `onSend` and `handleStart` both materialize non-empty attachments into the new workspace's worktree and append the resulting paths to the launch prompt before calling `stageLaunch`.

- [ ] **Step 1: Write the failing tests**

Add to `src/panels/kanban/KanbanBoard.test.tsx`, right after the existing `it("onSend prepends project AI preferences to the launch prompt", ...)` test (around line 159):

```ts
  it("onSend materializes attachments into the new workspace's worktree and appends paths to the launch prompt", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", name: "A", path: "/p1" })],
      backends: [makeBackend({ id: "claude", active: true })],
    });
    // "hello" as bytes, so the composer's own base64 encoder (fixed in Task 9)
    // produces exactly this — the mock below must match what the component
    // will actually send, not an arbitrary string.
    const attachments = [{ name: "screenshot.png", content: "aGVsbG8=", encoding: "base64" as const, size: 5 }];
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === "kanban_list") return [];
      if (cmd === "git_branches") return ["main"];
      if (cmd === "kanban_upsert") return makeKanbanTask({ id: "t-new", status: "todo", attachments });
      if (cmd === "workspace_create")
        return makeWorkspace({ id: "ws-new", projectId: "p1", branch: "main", worktreePath: "/wt/ws-new" });
      if (cmd === "kanban_materialize_attachments")
        return { paths: ["/wt/ws-new/.maverick/attachments/t-new/screenshot.png"] };
      return undefined;
    }) as unknown as typeof invoke);

    renderWithProviders(<KanbanBoard />);
    await waitFor(() => expect(screen.getByTestId("kanban-board")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("composer-project"));
    await userEvent.click(await screen.findByRole("option", { name: "A" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("git_branches", expect.any(Object)));
    await waitFor(() => expect(screen.getByTestId("composer-branch")).toHaveTextContent("main"));

    // The mocked kanban_upsert response above is what the assertions below
    // check against, but `onSend` builds its RPC call from `payload.attachments`
    // — the attachments actually present in the composer's own state — so a
    // real file must be attached through the UI, or `payload.attachments`
    // stays empty and the implementation correctly never calls
    // kanban_materialize_attachments (which would make this test fail for
    // the wrong reason: not "feature broken", but "test forgot to attach").
    const fileInput = screen.getByTestId("composer-file-input");
    const mockFile = new File([new TextEncoder().encode("hello")], "screenshot.png", { type: "image/png" });
    await userEvent.upload(fileInput, mockFile);
    await waitFor(() => expect(screen.getByTestId("composer-attachment")).toBeInTheDocument());

    await userEvent.type(screen.getByTestId("composer-prompt"), "Fix the thing");
    await waitFor(() => expect(screen.getByTestId("composer-send")).not.toBeDisabled());
    await userEvent.click(screen.getByTestId("composer-send"));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("kanban_materialize_attachments", {
        worktreePath: "/wt/ws-new",
        taskId: "t-new",
        attachments,
      })
    );
    await waitFor(() =>
      expect(useWorkbench.getState().launchSpecs["ws-new"]?.prompt).toBe(
        "Fix the thing\n\n[Attached files]\n- /wt/ws-new/.maverick/attachments/t-new/screenshot.png"
      )
    );
  });

  it("onSend skips materialization and launches normally when there are no attachments", async () => {
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", name: "A", path: "/p1" })],
      backends: [makeBackend({ id: "claude", active: true })],
    });
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === "kanban_list") return [];
      if (cmd === "git_branches") return ["main"];
      if (cmd === "kanban_upsert") return makeKanbanTask({ id: "t-new", status: "todo", attachments: [] });
      if (cmd === "workspace_create")
        return makeWorkspace({ id: "ws-new", projectId: "p1", branch: "main", worktreePath: "/wt/ws-new" });
      return undefined;
    }) as unknown as typeof invoke);

    renderWithProviders(<KanbanBoard />);
    await waitFor(() => expect(screen.getByTestId("kanban-board")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("composer-project"));
    await userEvent.click(await screen.findByRole("option", { name: "A" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("git_branches", expect.any(Object)));
    await waitFor(() => expect(screen.getByTestId("composer-branch")).toHaveTextContent("main"));
    await userEvent.type(screen.getByTestId("composer-prompt"), "Fix the thing");
    await waitFor(() => expect(screen.getByTestId("composer-send")).not.toBeDisabled());
    await userEvent.click(screen.getByTestId("composer-send"));

    await waitFor(() => expect(useWorkbench.getState().launchSpecs["ws-new"]?.prompt).toBe("Fix the thing"));
    expect(invoke).not.toHaveBeenCalledWith("kanban_materialize_attachments", expect.anything());
  });

  it("onSend logs a warning and launches without attachment paths when materialization fails", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    useWorkbench.setState({
      ...initial,
      projects: [makeProject({ id: "p1", name: "A", path: "/p1" })],
      backends: [makeBackend({ id: "claude", active: true })],
    });
    const attachments = [{ name: "a.png", content: "AA==", encoding: "base64" as const, size: 1 }];
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === "kanban_list") return [];
      if (cmd === "git_branches") return ["main"];
      if (cmd === "kanban_upsert") return makeKanbanTask({ id: "t-new", status: "todo", attachments });
      if (cmd === "workspace_create")
        return makeWorkspace({ id: "ws-new", projectId: "p1", branch: "main", worktreePath: "/wt/ws-new" });
      if (cmd === "kanban_materialize_attachments") throw new Error("disk full");
      return undefined;
    }) as unknown as typeof invoke);

    renderWithProviders(<KanbanBoard />);
    await waitFor(() => expect(screen.getByTestId("kanban-board")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("composer-project"));
    await userEvent.click(await screen.findByRole("option", { name: "A" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("git_branches", expect.any(Object)));
    await waitFor(() => expect(screen.getByTestId("composer-branch")).toHaveTextContent("main"));

    // Same reason as the previous test: attach through the real UI so
    // `payload.attachments` is non-empty and kanban_materialize_attachments
    // actually gets called (and, here, throws).
    const fileInput = screen.getByTestId("composer-file-input");
    const mockFile = new File([new Uint8Array([0])], "a.png", { type: "image/png" });
    await userEvent.upload(fileInput, mockFile);
    await waitFor(() => expect(screen.getByTestId("composer-attachment")).toBeInTheDocument());

    await userEvent.type(screen.getByTestId("composer-prompt"), "Fix the thing");
    await waitFor(() => expect(screen.getByTestId("composer-send")).not.toBeDisabled());
    await userEvent.click(screen.getByTestId("composer-send"));

    await waitFor(() => expect(useWorkbench.getState().launchSpecs["ws-new"]?.prompt).toBe("Fix the thing"));
    expect(consoleWarn).toHaveBeenCalledWith(
      "materializeAttachments failed; launching without attachments",
      expect.any(Error)
    );
    consoleWarn.mockRestore();
  });
```

Add a parallel test for `handleStart`, right after the existing `it("handleStart links the spawned workspace to the task (#7)", ...)` test:

```ts
  it("handleStart materializes an existing task's attachments and appends paths to the launch prompt", async () => {
    const project = makeProject({ id: "p1", path: "/p1" });
    useWorkbench.setState({
      ...initial,
      projects: [project],
      backends: [makeBackend({ id: "claude-code", command: "claude", active: true })],
    });
    const attachments = [{ name: "notes.txt", content: "hello", encoding: "utf8" as const, size: 5 }];
    const task = makeKanbanTask({
      id: "t1",
      projectId: "p1",
      title: "Implement auth",
      description: "",
      branch: "feat/auth",
      agentBackend: "claude-code",
      status: "todo",
      attachments,
    });

    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === "kanban_list") return [task];
      if (cmd === "workspace_create")
        return makeWorkspace({ id: "ws-new", projectId: "p1", branch: "feat/auth", worktreePath: "/wt/ws-new" });
      if (cmd === "kanban_materialize_attachments")
        return { paths: ["/wt/ws-new/.maverick/attachments/t1/notes.txt"] };
      if (cmd === "kanban_upsert") return { ...task, status: "in_progress" };
      return undefined;
    }) as unknown as typeof invoke);

    renderWithProviders(<KanbanBoard />);
    await waitFor(() => screen.getByTestId("kanban-board"));
    await userEvent.click(screen.getByTestId("kanban-start"));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("kanban_materialize_attachments", {
        worktreePath: "/wt/ws-new",
        taskId: "t1",
        attachments,
      })
    );
    await waitFor(() =>
      expect(useWorkbench.getState().launchSpecs["ws-new"]?.prompt).toBe(
        "Implement auth\n\n[Attached files]\n- /wt/ws-new/.maverick/attachments/t1/notes.txt"
      )
    );
  });
```

This mirrors the exact fixture shape (`kanban-start` testid, `ws-new` workspace id, `claude-code` backend) already used by the passing `it("handleStart creates workspace and stages a terminal launch with title+description", ...)` test at line 288, with `attachments` and a `kanban_materialize_attachments` mock branch added.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run vitest run src/panels/kanban/KanbanBoard.test.tsx -t "materializ"`
Expected: FAIL — `kanban_materialize_attachments` is never invoked; launch prompts don't include the `[Attached files]` block.

- [ ] **Step 3: Implement the wiring**

In `src/panels/kanban/KanbanBoard.tsx`, update the imports:

```ts
import {
  gitDiffStat,
  kanbanDelete,
  kanbanList,
  kanbanMaterializeAttachments,
  kanbanUpsert,
  projectSettingsGet,
} from "@/lib/tauri";
import { appendAttachments, buildLaunchPrompt } from "@/lib/agent-prompt";
```

Add `Attachment` to the existing type import:

```ts
import type { Attachment, DiffStat, KanbanTask } from "@/lib/ipc";
```

Add a shared helper function right after the existing `stageLaunch` function (both `onSend` and `handleStart` need identical materialize-then-append behavior — factoring it out keeps them in sync):

```ts
// Best-effort: a materialization failure (e.g. disk full) must not block the
// launch — the task still starts, just without attachment paths in the prompt.
async function materializeAndAppend(
  worktreePath: string,
  taskId: string,
  attachments: Attachment[],
  prompt: string
): Promise<string> {
  if (attachments.length === 0) return prompt;
  try {
    const { paths } = await kanbanMaterializeAttachments(worktreePath, taskId, attachments);
    return appendAttachments(prompt, paths);
  } catch (e) {
    console.warn("materializeAttachments failed; launching without attachments", e);
    return prompt;
  }
}
```

In `handleStart`, change:

```tsx
      const ws = await create(task.projectId, branch, backend, baseBranch);
      const launchPrompt = settings ? buildLaunchPrompt(settings.preferences, prompt) : prompt;
      stageLaunch(ws.id, backend, launchPrompt);
```

to:

```tsx
      const ws = await create(task.projectId, branch, backend, baseBranch);
      const launchPrompt = await materializeAndAppend(
        ws.worktreePath,
        task.id,
        task.attachments,
        settings ? buildLaunchPrompt(settings.preferences, prompt) : prompt
      );
      stageLaunch(ws.id, backend, launchPrompt);
```

In `onSend`, change:

```tsx
      const ws = await create(payload.projectId, branch, payload.agentBackend, payload.baseBranch);
      const prompt = settings ? buildLaunchPrompt(settings.preferences, payload.prompt) : payload.prompt;
      stageLaunch(ws.id, payload.agentBackend, prompt);
```

to:

```tsx
      const ws = await create(payload.projectId, branch, payload.agentBackend, payload.baseBranch);
      const prompt = await materializeAndAppend(
        ws.worktreePath,
        task.id,
        payload.attachments,
        settings ? buildLaunchPrompt(settings.preferences, payload.prompt) : payload.prompt
      );
      stageLaunch(ws.id, payload.agentBackend, prompt);
```

(`task` here is the same variable already returned by the earlier `const task = await kanbanUpsert({...})` call in `onSend` — it carries the persisted `id`.)

- [ ] **Step 4: Run the full test file to verify everything passes**

Run: `bun run vitest run src/panels/kanban/KanbanBoard.test.tsx`
Expected: PASS, full file green (this file has ~30 pre-existing tests — confirm none regressed, especially the two `#7`/`#8`-tagged tests and the two `project_settings_get`-throws tests, since they touch the same code paths you just edited).

- [ ] **Step 5: Commit**

```bash
git add src/panels/kanban/KanbanBoard.tsx src/panels/kanban/KanbanBoard.test.tsx
git commit -m "feat(kanban): materialize task attachments into the worktree and forward paths to the launched agent"
```

---

### Task 12: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full frontend suite with coverage**

Run: `bun run test:coverage`
Expected: all tests pass. Coverage was reported at 99.54/95.5/98.23 (lines/branches/functions) against a 100/95/100/100 gate in the most recent audit, before this change — check whether your new code brings the aggregate under or over the gate; if it's still short, that's a pre-existing gap unrelated to this feature and should be called out in your final report rather than chased down here, unless a specific new line/branch you just added is what's uncovered (fix those).

- [ ] **Step 2: Run the sidecar suite**

Run: `cd sidecar && bun test`
Expected: all tests pass, including the new `file-reader.test.ts`, `attachment-materializer.test.ts`, and `rpc-handlers.test.ts` cases.

- [ ] **Step 3: Run the Rust checks**

Run: `cd src-tauri && cargo check && cargo test`
Expected: `cargo check` is clean. `cargo test` may still show the pre-existing 6 `resolve_bun` Windows-path-literal failures on macOS (per the prior audit) — those are unrelated to this change; confirm no *new* Rust test failures were introduced.

- [ ] **Step 4: Manual verification in the running app**

Run: `bun run tauri dev`

- Open the Kanban view, drag an image file from Finder/Explorer onto the Task Composer, and confirm it appears as an attachment chip (not just a visual highlight that then does nothing).
- Open the agent/backend picker in the Task Composer and confirm each installed backend shows its brand icon, not just plain text.
- Send a task with a dropped image attached, let it spin up a workspace, and check the workspace's worktree at `.maverick/attachments/<taskId>/` for the materialized file, and confirm the terminal's typed launch command includes an `[Attached files]` block referencing it.
- Confirm the Task Composer still works when opened without ever having picked a project from a dropdown elsewhere (i.e. the branch list populates immediately using the active workspace's project).

- [ ] **Step 5: Report**

If every check in Steps 1–4 passes, the feature is done per this repo's definition of done. If anything in Step 1 or 3 fails in a way not already called out as pre-existing/unrelated, stop and fix it before considering this complete — do not mark it done with a red suite.
