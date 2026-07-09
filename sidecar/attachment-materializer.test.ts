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
