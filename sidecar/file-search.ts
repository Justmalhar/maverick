import { readdirSync, statSync } from "fs";
import { join, relative, basename } from "path";
import { defaultShell } from "./deps";
import { SKIP_DIRS } from "./fs-watcher";
import type { Shell } from "./types";

export interface SearchHit {
  /** Path relative to the search root, forward-slash normalized. */
  rel: string;
  /** File name only. */
  name: string;
  // QuickOpen is a files-only finder: `git ls-files` enumerates files (never
  // directories) and the manual walk only matches leaf files, so every hit is a
  // file and this is always false. The field is retained for IPC-type parity
  // with FileEntry and a possible future dir-aware finder.
  isDirectory: false;
}

export interface SearchResult {
  hits: SearchHit[];
  /** True if the scan stopped early (entry budget or hit cap reached). */
  truncated: boolean;
}

interface SearchParams {
  worktreePath: string;
  query: string;
  limit?: number;
}

// Hard cap on entries the walk is allowed to visit before bailing. Protects
// against pathological roots where there's no .gitignore and the tree is
// effectively unbounded.
const MAX_SCANNED = 50_000;
const DEFAULT_LIMIT = 200;
const HARD_LIMIT = 1_000;

export interface FileSearchOptions {
  shell?: Shell;
  readdir?: (path: string) => string[];
  stat?: (path: string) => { isDirectory: boolean };
  maxScanned?: number;
}

export class FileSearch {
  private shell: Shell;
  private readdir: (path: string) => string[];
  private stat: (path: string) => { isDirectory: boolean };
  private maxScanned: number;

  constructor(opts: FileSearchOptions = {}) {
    this.shell = opts.shell ?? defaultShell;
    this.readdir = opts.readdir ?? ((p) => readdirSync(p));
    this.stat =
      opts.stat ??
      ((p) => {
        const s = statSync(p);
        return { isDirectory: s.isDirectory() };
      });
    this.maxScanned = opts.maxScanned ?? MAX_SCANNED;
  }

  /**
   * Returns up to `limit` FILES whose relative path contains `query`
   * (case-insensitive). This is a files-only finder: directories are descended
   * but never emitted as hits, so every {@link SearchHit} has `isDirectory:
   * false`. Honors .gitignore via `git ls-files` when the worktree is a git
   * repo; otherwise falls back to a SKIP_DIRS-pruned manual walk. Both paths
   * respect a MAX_SCANNED budget and surface `truncated` when hit.
   */
  async search(params: SearchParams): Promise<SearchResult> {
    const q = params.query.trim().toLowerCase();
    if (q === "") return { hits: [], truncated: false };
    const cap = Math.min(params.limit ?? DEFAULT_LIMIT, HARD_LIMIT);

    const tracked = await this.gitFiles(params.worktreePath);
    const { rels, truncated } = tracked
      ? this.fromList(tracked, q)
      : this.fromWalk(params.worktreePath, q);

    const out: SearchHit[] = [];
    let capTruncated = false;
    for (const rel of rels) {
      if (out.length >= cap) {
        capTruncated = true;
        break;
      }
      const name = basename(rel);
      out.push({ rel, name, isDirectory: false });
    }

    out.sort((a, b) => {
      const an = a.name.toLowerCase().includes(q) ? 0 : 1;
      const bn = b.name.toLowerCase().includes(q) ? 0 : 1;
      return an - bn || a.rel.length - b.rel.length;
    });

    return { hits: out, truncated: truncated || capTruncated };
  }

  // `git ls-files` lists tracked files plus untracked-but-not-ignored files,
  // which is exactly .gitignore-aware semantics; `-z` keeps paths with spaces
  // intact. Returns null when the path is not a git repo so the caller falls
  // back to the manual walk.
  private async gitFiles(worktreePath: string): Promise<string[] | null> {
    try {
      const out = await this.shell.text(
        ["git", "-C", worktreePath, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        undefined
      );
      return out.split("\0").filter((p) => p !== "");
    } catch {
      return null;
    }
  }

  private fromList(files: string[], q: string): { rels: string[]; truncated: boolean } {
    const rels: string[] = [];
    let scanned = 0;
    let truncated = false;
    for (const rel of files) {
      scanned++;
      if (scanned > this.maxScanned) {
        truncated = true;
        break;
      }
      const segs = rel.split("/");
      if (segs.some((s) => SKIP_DIRS.has(s))) continue;
      if (rel.toLowerCase().includes(q)) rels.push(rel);
    }
    return { rels, truncated };
  }

  private fromWalk(root: string, q: string): { rels: string[]; truncated: boolean } {
    const rels: string[] = [];
    const counter = { scanned: 0 };
    const truncated = this.walk(root, root, q, rels, counter);
    return { rels, truncated };
  }

  // Returns true when the budget was exhausted (truncated). Depth-first;
  // SKIP_DIRS are pruned before descent so generated trees never inflate the
  // scan counter.
  private walk(
    root: string,
    dir: string,
    q: string,
    out: string[],
    counter: { scanned: number }
  ): boolean {
    let entries: string[];
    try {
      entries = this.readdir(dir);
    } catch {
      return false;
    }
    for (const name of entries) {
      counter.scanned++;
      if (counter.scanned > this.maxScanned) return true;
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      let info: { isDirectory: boolean };
      try {
        info = this.stat(full);
      } catch {
        continue;
      }
      if (info.isDirectory) {
        if (this.walk(root, full, q, out, counter)) return true;
      } else {
        const rel = relative(root, full);
        if (rel.toLowerCase().includes(q)) out.push(rel);
      }
    }
    return false;
  }
}
