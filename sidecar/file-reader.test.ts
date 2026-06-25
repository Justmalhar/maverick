import { describe, test, expect } from "bun:test";
import { FileReader } from "./file-reader";

describe("FileReader", () => {
  test("reads UTF-8 text content", () => {
    const fr = new FileReader({
      stat: () => ({ size: 5, mtimeMs: 1000 }),
      readFile: () => Buffer.from("hello"),
    });
    const res = fr.read({ filePath: "/a.txt" });
    expect(res).toEqual({ content: "hello", size: 5, binary: false, unreadable: false, mtime: 1000, encoding: "utf8" });
  });

  test("flags binary content (NUL byte) and omits it", () => {
    const fr = new FileReader({
      stat: () => ({ size: 3, mtimeMs: 2000 }),
      readFile: () => Buffer.from([0x41, 0x00, 0x42]),
    });
    const res = fr.read({ filePath: "/a.bin" });
    expect(res.binary).toBe(true);
    expect(res.content).toBe("");
    expect(res.unreadable).toBe(false);
    expect(res.mtime).toBe(2000);
  });

  test("decodes a UTF-16LE (BOM) file as text, not binary (#27)", () => {
    // "Hi" as UTF-16LE: FF FE 48 00 69 00 — contains NUL bytes but is valid text.
    const buf = Buffer.from([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00]);
    const fr = new FileReader({ stat: () => ({ size: buf.length, mtimeMs: 1 }), readFile: () => buf });
    const res = fr.read({ filePath: "/u16le.txt" });
    expect(res.binary).toBe(false);
    expect(res.content).toBe("Hi");
    expect(res.encoding).toBe("utf16le");
  });

  test("decodes a UTF-16BE (BOM) file as text (#27)", () => {
    // "Hi" as UTF-16BE: FE FF 00 48 00 69.
    const buf = Buffer.from([0xfe, 0xff, 0x00, 0x48, 0x00, 0x69]);
    const fr = new FileReader({ stat: () => ({ size: buf.length, mtimeMs: 1 }), readFile: () => buf });
    const res = fr.read({ filePath: "/u16be.txt" });
    expect(res.content).toBe("Hi");
    expect(res.encoding).toBe("utf16be");
  });

  test("strips a UTF-8 BOM and records the encoding (#27)", () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hi", "utf8")]);
    const fr = new FileReader({ stat: () => ({ size: buf.length, mtimeMs: 1 }), readFile: () => buf });
    const res = fr.read({ filePath: "/u8bom.txt" });
    expect(res.content).toBe("hi"); // leading U+FEFF stripped
    expect(res.encoding).toBe("utf8-bom");
  });

  test("refuses oversized files without reading them", () => {
    let readCalled = false;
    const fr = new FileReader({
      maxBytes: 10,
      stat: () => ({ size: 11, mtimeMs: 3000 }),
      readFile: () => {
        readCalled = true;
        return Buffer.from("x");
      },
    });
    const res = fr.read({ filePath: "/big" });
    expect(res.binary).toBe(true);
    expect(res.size).toBe(11);
    expect(readCalled).toBe(false);
    expect(res.mtime).toBe(3000);
  });

  test("returns unreadable when stat throws", () => {
    const fr = new FileReader({
      stat: () => {
        throw new Error("ENOENT");
      },
      readFile: () => Buffer.from(""),
    });
    const res = fr.read({ filePath: "/missing" });
    expect(res).toEqual({ content: "", size: 0, binary: false, unreadable: true, mtime: 0, encoding: "utf8" });
  });

  test("returns unreadable when readFile throws", () => {
    const fr = new FileReader({
      stat: () => ({ size: 4, mtimeMs: 5000 }),
      readFile: () => {
        throw new Error("EACCES");
      },
    });
    const res = fr.read({ filePath: "/locked" });
    expect(res.unreadable).toBe(true);
    expect(res.size).toBe(4);
    expect(res.mtime).toBe(0);
  });

  test("read returns the file mtime", () => {
    const fr = new FileReader({
      stat: () => ({ size: 5, mtimeMs: 9999 }),
      readFile: () => Buffer.from("hello"),
    });
    const res = fr.read({ filePath: "/a.txt" });
    expect(res.mtime).toBeGreaterThan(0);
    expect(res.mtime).toBe(9999);

    const frUnreadable = new FileReader({
      stat: () => { throw new Error("ENOENT"); },
      readFile: () => Buffer.from(""),
    });
    const resUnreadable = frUnreadable.read({ filePath: "/missing" });
    expect(resUnreadable.mtime).toBe(0);
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
