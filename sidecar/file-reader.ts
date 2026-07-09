import { readFileSync, statSync } from "fs";

/**
 * Text encoding detected from a leading BOM. Recorded on a read so an editor can
 * round-trip the file's original encoding on save instead of forcing UTF-8.
 */
export type TextEncoding = "utf8" | "utf8-bom" | "utf16le" | "utf16be";

export interface ReadResult {
  /** Decoded text content, or empty string when binary/too-large/unreadable. */
  content: string;
  /** Size in bytes of the file on disk. */
  size: number;
  /** True when the file looks binary (NUL byte, no recognized text BOM) or exceeds the cap. */
  binary: boolean;
  /** True when the file could not be read at all (missing/permission). */
  unreadable: boolean;
  /** mtimeMs at read time; 0 when unreadable. */
  mtime: number;
  /** Source encoding (from a BOM); echo back to file_write to preserve it. */
  encoding: TextEncoding;
}

/** A leading BOM identifying a UTF-16/UTF-8-with-BOM text file, or null. */
export function detectBomEncoding(buf: Buffer): Exclude<TextEncoding, "utf8"> | null {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return "utf8-bom";
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return "utf16le";
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return "utf16be";
  return null;
}

function decodeWithBom(buf: Buffer, encoding: Exclude<TextEncoding, "utf8">): string {
  if (encoding === "utf8-bom") return buf.subarray(3).toString("utf8");
  if (encoding === "utf16le") return buf.subarray(2).toString("utf16le");
  // UTF-16BE: Node has no utf16be decoder — byte-swap a COPY to LE then decode.
  const be = Buffer.from(buf.subarray(2));
  if (be.length % 2 !== 0) return be.toString("utf8");
  return be.swap16().toString("utf16le");
}

// Above this size we refuse to slurp text into the preview pane: large files
// blow the IPC budget and the editor pane is not a pager.
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

// Above this, refuse to base64-encode into memory/IPC — a defensive backstop
// against a pathological drag-drop, not the app's real attachment size limit
// (that's enforced by the caller against the `size` this returns).
const MAX_BINARY_BYTES = 25 * 1024 * 1024;

export interface FileReaderOptions {
  readFile?: (path: string) => Buffer;
  stat?: (path: string) => { size: number; mtimeMs: number };
  maxBytes?: number;
}

export class FileReader {
  private readFile: (path: string) => Buffer;
  private stat: (path: string) => { size: number; mtimeMs: number };
  private maxBytes: number;

  constructor(opts: FileReaderOptions = {}) {
    this.readFile = opts.readFile ?? ((p) => readFileSync(p));
    this.stat = opts.stat ?? ((p) => statSync(p));
    this.maxBytes = opts.maxBytes ?? MAX_TEXT_BYTES;
  }

  /** Reads `filePath` as UTF-8 text, refusing binary or oversized content. */
  read(params: { filePath: string }): ReadResult {
    let size: number;
    let mtime: number;
    try {
      const st = this.stat(params.filePath);
      size = st.size;
      mtime = st.mtimeMs;
    } catch {
      return { content: "", size: 0, binary: false, unreadable: true, mtime: 0, encoding: "utf8" };
    }
    if (size > this.maxBytes) {
      return { content: "", size, binary: true, unreadable: false, mtime, encoding: "utf8" };
    }
    let buf: Buffer;
    try {
      buf = this.readFile(params.filePath);
    } catch {
      return { content: "", size, binary: false, unreadable: true, mtime: 0, encoding: "utf8" };
    }
    // A recognized text BOM wins over the NUL heuristic: UTF-16 encodes ASCII
    // with a 0x00 high byte (so every UTF-16 file "contains NUL"), and Windows
    // tools (Notepad "Unicode", PowerShell Out-File) emit these routinely.
    const bom = detectBomEncoding(buf);
    if (bom) {
      return { content: decodeWithBom(buf, bom), size, binary: false, unreadable: false, mtime, encoding: bom };
    }
    if (buf.includes(0)) {
      return { content: "", size, binary: true, unreadable: false, mtime, encoding: "utf8" };
    }
    return { content: buf.toString("utf8"), size, binary: false, unreadable: false, mtime, encoding: "utf8" };
  }

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
}
