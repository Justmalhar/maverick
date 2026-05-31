import { readFileSync, statSync } from "fs";

export interface ReadResult {
  /** UTF-8 text content, or empty string when binary/too-large/unreadable. */
  content: string;
  /** Size in bytes of the file on disk. */
  size: number;
  /** True when the file looks binary (NUL byte) or exceeds the size cap. */
  binary: boolean;
  /** True when the file could not be read at all (missing/permission). */
  unreadable: boolean;
}

// Above this size we refuse to slurp text into the preview pane: large files
// blow the IPC budget and the editor pane is not a pager.
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

export interface FileReaderOptions {
  readFile?: (path: string) => Buffer;
  stat?: (path: string) => { size: number };
  maxBytes?: number;
}

export class FileReader {
  private readFile: (path: string) => Buffer;
  private stat: (path: string) => { size: number };
  private maxBytes: number;

  constructor(opts: FileReaderOptions = {}) {
    this.readFile = opts.readFile ?? ((p) => readFileSync(p));
    this.stat = opts.stat ?? ((p) => ({ size: statSync(p).size }));
    this.maxBytes = opts.maxBytes ?? MAX_TEXT_BYTES;
  }

  /** Reads `filePath` as UTF-8 text, refusing binary or oversized content. */
  read(params: { filePath: string }): ReadResult {
    let size: number;
    try {
      size = this.stat(params.filePath).size;
    } catch {
      return { content: "", size: 0, binary: false, unreadable: true };
    }
    if (size > this.maxBytes) {
      return { content: "", size, binary: true, unreadable: false };
    }
    let buf: Buffer;
    try {
      buf = this.readFile(params.filePath);
    } catch {
      return { content: "", size, binary: false, unreadable: true };
    }
    if (buf.includes(0)) {
      return { content: "", size, binary: true, unreadable: false };
    }
    return { content: buf.toString("utf8"), size, binary: false, unreadable: false };
  }
}
