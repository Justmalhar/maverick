import { mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { TextEncoding } from "./file-reader";

/** Re-attach the source BOM + encode so a UTF-16/UTF-8-BOM file round-trips. */
export function encodeContent(content: string, encoding: TextEncoding = "utf8"): Buffer {
  switch (encoding) {
    case "utf8-bom":
      return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content, "utf8")]);
    case "utf16le":
      return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, "utf16le")]);
    case "utf16be": {
      const le = Buffer.from(content, "utf16le");
      le.swap16();
      return Buffer.concat([Buffer.from([0xfe, 0xff]), le]);
    }
    default:
      return Buffer.from(content, "utf8");
  }
}

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
  write(params: {
    filePath: string;
    content: string;
    expectedMtime?: number;
    encoding?: TextEncoding;
  }): FileWriteResult {
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
      writeFileSync(tmp, encodeContent(params.content, params.encoding));
      renameSync(tmp, params.filePath);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    return { mtime: this.stat(params.filePath).mtimeMs };
  }
}
