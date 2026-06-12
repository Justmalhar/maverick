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
