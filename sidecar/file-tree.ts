import { readdirSync, statSync } from "fs";
import { join, relative, basename } from "path";
import { defaultShell } from "./deps";
import type { FileEntry, Shell } from "./types";

interface TreeParams {
  worktreePath: string;
  maxDepth?: number;
  ignore?: string[];
}

export interface FileTreeOptions {
  shell?: Shell;
  readdir?: (path: string) => string[];
  stat?: (path: string) => { isDirectory: boolean };
}

export class FileTree {
  private shell: Shell;
  private readdir: (path: string) => string[];
  private stat: (path: string) => { isDirectory: boolean };

  constructor(opts: FileTreeOptions = {}) {
    this.shell = opts.shell ?? defaultShell;
    this.readdir = opts.readdir ?? ((p) => readdirSync(p));
    this.stat =
      opts.stat ??
      ((p) => {
        const s = statSync(p);
        return { isDirectory: s.isDirectory() };
      });
  }

  async tree(params: TreeParams): Promise<FileEntry[]> {
    const statusMap = await this.collectStatus(params.worktreePath);
    const ignore = new Set([".git", "node_modules", "dist", "target", ".next", ".maverick", ...(params.ignore ?? [])]);
    const maxDepth = params.maxDepth ?? 6;
    return this.walk(params.worktreePath, params.worktreePath, statusMap, ignore, 0, maxDepth);
  }

  private walk(
    root: string,
    dir: string,
    statusMap: Map<string, FileEntry["status"]>,
    ignore: Set<string>,
    depth: number,
    maxDepth: number
  ): FileEntry[] {
    if (depth > maxDepth) return [];
    let entries: string[];
    try {
      entries = this.readdir(dir);
    } catch {
      return [];
    }
    const out: FileEntry[] = [];
    for (const name of entries.sort()) {
      if (ignore.has(name)) continue;
      const full = join(dir, name);
      let info: { isDirectory: boolean };
      try {
        info = this.stat(full);
      } catch {
        continue;
      }
      const rel = relative(root, full);
      const entry: FileEntry = {
        path: rel,
        name: basename(full),
        isDirectory: info.isDirectory,
        status: statusMap.get(rel),
      };
      if (info.isDirectory) {
        entry.children = this.walk(root, full, statusMap, ignore, depth + 1, maxDepth);
      }
      out.push(entry);
    }
    return out;
  }

  private async collectStatus(worktreePath: string): Promise<Map<string, FileEntry["status"]>> {
    const map = new Map<string, FileEntry["status"]>();
    try {
      const output = await this.shell.text(["git", "-C", worktreePath, "status", "--porcelain"], undefined);
      for (const line of output.split("\n")) {
        if (!line) continue;
        const code = line.slice(0, 2).trim();
        const path = line.slice(3).trim();
        let status: FileEntry["status"];
        if (code.includes("A") || code === "??") status = "A";
        else if (code.includes("D")) status = "D";
        else if (code.includes("R")) status = "R";
        else if (code.includes("M")) status = "M";
        if (status) map.set(path, status);
      }
    } catch {
      return map;
    }
    return map;
  }
}
