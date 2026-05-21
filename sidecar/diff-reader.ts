import { defaultShell } from "./deps";
import type { DiffFile, DiffHunk, DiffResult, Shell } from "./types";

interface GetParams {
  worktreePath: string;
  filePath?: string;
}

interface HunkParams {
  worktreePath: string;
  patch: string;
}

export interface DiffReaderOptions {
  shell?: Shell;
}

export class DiffReader {
  private shell: Shell;

  constructor(opts: DiffReaderOptions = {}) {
    this.shell = opts.shell ?? defaultShell;
  }

  async get(params: GetParams): Promise<DiffResult> {
    const cmd = ["git", "diff", "--unified=3"];
    if (params.filePath) cmd.push("--", params.filePath);
    const output = await this.shell.text(cmd, params.worktreePath);
    return { files: DiffReader.parse(output) };
  }

  async stageHunk(params: HunkParams): Promise<{ ok: true }> {
    const { exitCode, stderr } = await this.shell.run(
      ["git", "-C", params.worktreePath, "apply", "--cached", "-"],
      undefined
    );
    if (exitCode !== 0) throw new Error(stderr || "git apply --cached failed");
    return { ok: true };
  }

  async unstageHunk(params: HunkParams): Promise<{ ok: true }> {
    const { exitCode, stderr } = await this.shell.run(
      ["git", "-C", params.worktreePath, "apply", "--cached", "-R", "-"],
      undefined
    );
    if (exitCode !== 0) throw new Error(stderr || "git apply --cached -R failed");
    return { ok: true };
  }

  static parse(output: string): DiffFile[] {
    if (!output.trim()) return [];
    const files: DiffFile[] = [];
    const fileBlocks = output.split(/^diff --git /m).slice(1);
    for (const block of fileBlocks) {
      const lines = block.split("\n");
      const header = lines[0] ?? "";
      const pathMatch = header.match(/a\/(.+) b\/(.+)/);
      const path = pathMatch ? pathMatch[2] : "";
      let status: DiffFile["status"] = "M";
      let additions = 0;
      let deletions = 0;
      const hunks: DiffHunk[] = [];
      let current: { header: string; lines: string[] } | null = null;
      let hunkBodyStart = -1;
      const fileHeaderLines: string[] = [`diff --git ${header}`];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith("new file")) status = "A";
        else if (line.startsWith("deleted file")) status = "D";
        else if (line.startsWith("rename")) status = "R";
        if (line.startsWith("@@")) {
          if (current && hunkBodyStart >= 0) {
            const patchBody = lines.slice(hunkBodyStart, i).join("\n");
            hunks.push({
              header: current.header,
              lines: current.lines,
              patch: DiffReader.buildPatch(fileHeaderLines, current.header, patchBody),
            });
          }
          current = { header: line, lines: [] };
          hunkBodyStart = i + 1;
        } else if (current) {
          current.lines.push(line);
          if (line.startsWith("+") && !line.startsWith("+++")) additions++;
          else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
        } else if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file") || line.startsWith("similarity") || line.startsWith("rename")) {
          fileHeaderLines.push(line);
        }
      }
      if (current && hunkBodyStart >= 0) {
        const patchBody = lines.slice(hunkBodyStart).join("\n");
        hunks.push({
          header: current.header,
          lines: current.lines,
          patch: DiffReader.buildPatch(fileHeaderLines, current.header, patchBody),
        });
      }
      files.push({ path, status, additions, deletions, hunks });
    }
    return files;
  }

  private static buildPatch(fileHeader: string[], hunkHeader: string, body: string): string {
    return [...fileHeader, hunkHeader, body].join("\n").replace(/\n+$/, "\n");
  }
}
