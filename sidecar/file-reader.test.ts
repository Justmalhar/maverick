import { describe, test, expect } from "bun:test";
import { FileReader } from "./file-reader";

describe("FileReader", () => {
  test("reads UTF-8 text content", () => {
    const fr = new FileReader({
      stat: () => ({ size: 5 }),
      readFile: () => Buffer.from("hello"),
    });
    const res = fr.read({ filePath: "/a.txt" });
    expect(res).toEqual({ content: "hello", size: 5, binary: false, unreadable: false });
  });

  test("flags binary content (NUL byte) and omits it", () => {
    const fr = new FileReader({
      stat: () => ({ size: 3 }),
      readFile: () => Buffer.from([0x41, 0x00, 0x42]),
    });
    const res = fr.read({ filePath: "/a.bin" });
    expect(res.binary).toBe(true);
    expect(res.content).toBe("");
    expect(res.unreadable).toBe(false);
  });

  test("refuses oversized files without reading them", () => {
    let readCalled = false;
    const fr = new FileReader({
      maxBytes: 10,
      stat: () => ({ size: 11 }),
      readFile: () => {
        readCalled = true;
        return Buffer.from("x");
      },
    });
    const res = fr.read({ filePath: "/big" });
    expect(res.binary).toBe(true);
    expect(res.size).toBe(11);
    expect(readCalled).toBe(false);
  });

  test("returns unreadable when stat throws", () => {
    const fr = new FileReader({
      stat: () => {
        throw new Error("ENOENT");
      },
      readFile: () => Buffer.from(""),
    });
    const res = fr.read({ filePath: "/missing" });
    expect(res).toEqual({ content: "", size: 0, binary: false, unreadable: true });
  });

  test("returns unreadable when readFile throws", () => {
    const fr = new FileReader({
      stat: () => ({ size: 4 }),
      readFile: () => {
        throw new Error("EACCES");
      },
    });
    const res = fr.read({ filePath: "/locked" });
    expect(res.unreadable).toBe(true);
    expect(res.size).toBe(4);
  });

  test("default constructor builds without DI", () => {
    expect(new FileReader()).toBeInstanceOf(FileReader);
  });

  test("default readFile/stat read a real temp file", () => {
    const { mkdtempSync, writeFileSync, rmSync } = require("fs");
    const { tmpdir } = require("os");
    const { join } = require("path");
    const tmp = mkdtempSync(join(tmpdir(), "mvk-read-"));
    try {
      const p = join(tmp, "a.txt");
      writeFileSync(p, "real content");
      const res = new FileReader().read({ filePath: p });
      expect(res.content).toBe("real content");
      expect(res.binary).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
