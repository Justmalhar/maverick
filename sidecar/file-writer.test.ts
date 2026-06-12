import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
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
    const dir = dirname(p);
    expect(readdirSync(dir)).toEqual(["a.txt"]);
  });

  test("failure: write to nonexistent parent throws and leaves no temp artefacts", () => {
    // The fixture dir is a real tmpdir we control; writing to a path whose parent
    // does not exist causes mkdtempSync to throw before any .mv-write-* dir is
    // created — verified by asserting none appear under our fixture dir.
    const fixtureDir = mkdtempSync(join(tmpdir(), "mv-fw-guard-"));
    const ghost = join(fixtureDir, "nonexistent-subdir", "x.txt");
    const w = new FileWriter();
    expect(() => w.write({ filePath: ghost, content: "boom" })).toThrow();
    const entries = readdirSync(fixtureDir);
    expect(entries.some((e) => e.startsWith(".mv-write-"))).toBe(false);
  });
});
