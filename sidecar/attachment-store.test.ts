import { describe, test, expect } from "bun:test";
import { AttachmentStore, ATTACHMENT_THRESHOLD } from "./attachment-store";

describe("AttachmentStore", () => {
  test("inline returns text directly when below threshold", () => {
    const writes: Array<[string, string]> = [];
    const store = new AttachmentStore({
      writeFile: (p, c) => writes.push([p, c]),
      mkdir: () => {},
      ids: { uuid: () => "x", now: () => 1 },
    });
    const r = store.create({ worktreePath: "/r", text: "tiny" });
    expect(r.inlined).toBe(true);
    expect(r.ref).toBe("tiny");
    expect(writes).toHaveLength(0);
  });

  test("creates attachment file when over threshold", () => {
    const writes: Array<[string, string]> = [];
    const mkdirs: string[] = [];
    const store = new AttachmentStore({
      writeFile: (p, c) => writes.push([p, c]),
      mkdir: (p) => mkdirs.push(p),
      ids: { uuid: () => "x", now: () => 1234 },
      threshold: 4,
    });
    const r = store.create({ worktreePath: "/r", text: "12345" });
    expect(r.inlined).toBe(false);
    expect(r.ref).toMatch(/^@attachment:1234\.txt$/);
    expect(r.filePath.endsWith("1234.txt")).toBe(true);
    expect(mkdirs[0]).toContain("attachments");
    expect(writes[0][1]).toBe("12345");
  });

  test("uses default threshold constant", () => {
    expect(ATTACHMENT_THRESHOLD).toBe(5000);
    const store = new AttachmentStore();
    const r = store.create({ worktreePath: "/tmp/x", text: "small" });
    expect(r.inlined).toBe(true);
  });

  test("default writeFile and mkdir hit real fs", () => {
    const { mkdtempSync, rmSync, readFileSync } = require("fs");
    const { tmpdir } = require("os");
    const { join } = require("path");
    const tmp = mkdtempSync(join(tmpdir(), "mvk-att-"));
    try {
      const store = new AttachmentStore({ threshold: 1 });
      const r = store.create({ worktreePath: tmp, text: "abcdef" });
      expect(r.inlined).toBe(false);
      expect(readFileSync(r.filePath, "utf8")).toBe("abcdef");
      // call again — mkdir branch where dir already exists
      const r2 = store.create({ worktreePath: tmp, text: "qrstuv" });
      expect(r2.inlined).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
