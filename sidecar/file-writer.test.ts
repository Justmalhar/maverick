import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { FileWriter, FileWriteConflictError, encodeContent } from "./file-writer";
import { FileReader } from "./file-reader";

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

  test("encodeContent re-attaches the BOM for each encoding (#27)", () => {
    expect([...encodeContent("Hi", "utf16le")]).toEqual([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00]);
    expect([...encodeContent("Hi", "utf16be")]).toEqual([0xfe, 0xff, 0x00, 0x48, 0x00, 0x69]);
    expect([...encodeContent("hi", "utf8-bom")]).toEqual([0xef, 0xbb, 0xbf, 0x68, 0x69]);
    expect([...encodeContent("hi")]).toEqual([0x68, 0x69]); // plain utf8, no BOM
  });

  test("write + read round-trips a UTF-16LE file's encoding (#27)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mv-fw-"));
    const p = join(dir, "u16.txt");
    new FileWriter().write({ filePath: p, content: "héllo", encoding: "utf16le" });
    const res = new FileReader().read({ filePath: p });
    expect(res.encoding).toBe("utf16le");
    expect(res.content).toBe("héllo");
    expect(res.binary).toBe(false);
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
