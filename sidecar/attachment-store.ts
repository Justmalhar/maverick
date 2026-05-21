import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { defaultIds } from "./deps";
import type { IdProvider } from "./types";

interface CreateParams {
  worktreePath: string;
  text: string;
}

export const ATTACHMENT_THRESHOLD = 5000;

export interface AttachmentStoreOptions {
  ids?: IdProvider;
  writeFile?: (path: string, contents: string) => void;
  mkdir?: (path: string) => void;
  threshold?: number;
}

export class AttachmentStore {
  private ids: IdProvider;
  private writeFile: (path: string, contents: string) => void;
  private mkdir: (path: string) => void;
  private threshold: number;

  constructor(opts: AttachmentStoreOptions = {}) {
    this.ids = opts.ids ?? defaultIds;
    this.writeFile = opts.writeFile ?? ((p, c) => writeFileSync(p, c, "utf8"));
    this.mkdir =
      opts.mkdir ??
      ((p) => {
        if (!existsSync(p)) mkdirSync(p, { recursive: true });
      });
    this.threshold = opts.threshold ?? ATTACHMENT_THRESHOLD;
  }

  create(params: CreateParams): { filePath: string; ref: string; inlined: boolean } {
    if (params.text.length <= this.threshold) {
      return { filePath: "", ref: params.text, inlined: true };
    }
    const filename = `${this.ids.now()}.txt`;
    const dir = join(params.worktreePath, ".maverick", "attachments");
    this.mkdir(dir);
    const filePath = join(dir, filename);
    this.writeFile(filePath, params.text);
    return { filePath, ref: `@attachment:${filename}`, inlined: false };
  }
}
