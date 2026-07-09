import { existsSync, mkdirSync, writeFileSync } from "fs";
import { basename, join } from "path";

export interface AttachmentInput {
  name: string;
  content: string;
  encoding: "utf8" | "base64";
}

export interface MaterializeParams {
  worktreePath: string;
  taskId: string;
  attachments: AttachmentInput[];
}

export interface MaterializeResult {
  paths: string[];
}

export interface AttachmentMaterializerOptions {
  mkdir?: (path: string) => void;
  writeFile?: (path: string, contents: Buffer) => void;
}

// Attachment names arrive from the client (paste/drop/file-picker) and are
// never trusted as path components — basename strips directory components,
// then the character allowlist blocks anything left that could still act as
// a separator, so "../../etc/passwd" can't escape the attachments directory.
function sanitizeName(name: string): string {
  const base = basename(name.replace(/\\/g, "/"));
  const cleaned = base.replace(/[^A-Za-z0-9_.-]/g, "_");
  return cleaned || "attachment";
}

export class AttachmentMaterializer {
  private mkdir: (path: string) => void;
  private writeFile: (path: string, contents: Buffer) => void;

  constructor(opts: AttachmentMaterializerOptions = {}) {
    this.mkdir =
      opts.mkdir ??
      ((p) => {
        if (!existsSync(p)) mkdirSync(p, { recursive: true });
      });
    this.writeFile = opts.writeFile ?? ((p, c) => writeFileSync(p, c));
  }

  materialize(params: MaterializeParams): MaterializeResult {
    const dir = join(params.worktreePath, ".maverick", "attachments", params.taskId);
    this.mkdir(dir);
    const paths: string[] = [];
    for (const a of params.attachments) {
      const filePath = join(dir, sanitizeName(a.name));
      const buf = a.encoding === "base64" ? Buffer.from(a.content, "base64") : Buffer.from(a.content, "utf8");
      this.writeFile(filePath, buf);
      paths.push(filePath);
    }
    return { paths };
  }
}
