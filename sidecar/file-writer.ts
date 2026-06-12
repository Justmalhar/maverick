import { mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";

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
  write(params: { filePath: string; content: string; expectedMtime?: number }): FileWriteResult {
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
      writeFileSync(tmp, params.content, "utf8");
      renameSync(tmp, params.filePath);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    return { mtime: this.stat(params.filePath).mtimeMs };
  }
}
