import { watch, type FSWatcher } from "fs";
import { emit, stdoutNotifier } from "./deps";
import type { Notifier } from "./types";

// Quiet-gap before a batch flushes; MAX_WINDOW caps latency under a long stream.
const DEBOUNCE_MS = 150;
const MAX_WINDOW_MS = 1000;

// Matched on the final path component. Never watched even when expanded: large
// or generated trees where live updates cost more than they're worth. Mirrors
// the explorer/search deny-lists so the three surfaces agree on what is noise.
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  // VCS
  ".git",
  ".hg",
  ".svn",
  ".jj",
  // JS / web
  "node_modules",
  "bower_components",
  ".pnpm-store",
  ".yarn",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".astro",
  ".vite",
  ".turbo",
  ".parcel-cache",
  ".angular",
  ".vercel",
  ".netlify",
  ".output",
  ".cache",
  // Rust
  "target",
  // Python
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".nox",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  // JVM / .NET / Go
  ".gradle",
  "obj",
  "vendor",
  // Maverick
  ".maverick",
]);

export function isSkippedName(name: string): boolean {
  return SKIP_DIRS.has(name);
}

type WatchFn = (
  path: string,
  listener: (eventType: string, filename: string | null) => void
) => FSWatcher;

export interface FsWatcherOptions {
  notifier?: Notifier;
  /** Injectable for tests; defaults to node:fs watch. */
  watch?: WatchFn;
  /** Debounce window in ms. Injectable so tests don't wait the real 150ms. */
  debounceMs?: number;
  /** Max coalesce window in ms. */
  maxWindowMs?: number;
  /** Injectable clock so tests can assert the max-window cap deterministically. */
  now?: () => number;
}

interface WatchSession {
  root: string;
  // Keyed by absolute dir so a release at refcount zero can close exactly the
  // FSWatcher backing that dir, rather than leaking it until session teardown.
  watchers: Map<string, FSWatcher>;
  pending: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
  // Wall-clock start of the current coalesce batch; the flush is forced once
  // MAX_WINDOW elapses even if events keep arriving inside the debounce gap.
  batchStart: number | null;
}

/**
 * Watches a single active worktree (one level deep per requested directory) and
 * emits a SINGLE debounced `fs.changed` notification carrying the union of
 * changed paths, instead of one event per filesystem touch. Directories in
 * {@link SKIP_DIRS} are never watched. Lazy by design: callers add the dirs they
 * have expanded via {@link add}; nothing is watched recursively.
 */
export class FsWatcher {
  private notifier: Notifier;
  private watchFn: WatchFn;
  private debounceMs: number;
  private maxWindowMs: number;
  private now: () => number;
  private session: WatchSession | null = null;
  // Refcounted per absolute dir so the explorer and editor can independently
  // request the same directory; we only unwatch when the last requester releases.
  private refcounts = new Map<string, number>();

  constructor(opts: FsWatcherOptions = {}) {
    this.notifier = opts.notifier ?? stdoutNotifier;
    this.watchFn = opts.watch ?? (watch as unknown as WatchFn);
    this.debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
    this.maxWindowMs = opts.maxWindowMs ?? MAX_WINDOW_MS;
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Starts (or re-scopes) the watcher on `root`. Switching roots tears down the
   * previous session so only the active worktree is ever watched. `dirs` are the
   * already-expanded directories the caller wants live updates for (root is
   * always included).
   */
  start(params: { root: string; dirs?: string[] }): { watching: number } {
    const { root } = params;
    if (this.session && this.session.root !== root) {
      this.stop();
    }
    if (!this.session) {
      this.session = {
        root,
        watchers: new Map(),
        pending: new Set(),
        timer: null,
        batchStart: null,
      };
      this.refcounts.clear();
    }
    this.addDir(root);
    for (const dir of params.dirs ?? []) this.addDir(dir);
    return { watching: this.refcounts.size };
  }

  /** Adds extra directories to an already-started session (e.g. on expand). */
  add(params: { dirs: string[] }): { watching: number } {
    if (!this.session) throw new Error("fs.watch.add before fs.watch.start");
    for (const dir of params.dirs) this.addDir(dir);
    return { watching: this.refcounts.size };
  }

  /** Releases directories (e.g. on collapse). Unwatches only at refcount zero. */
  remove(params: { dirs: string[] }): { watching: number } {
    if (!this.session) return { watching: 0 };
    for (const dir of params.dirs) this.removeDir(dir);
    return { watching: this.refcounts.size };
  }

  /** Tears the session down entirely. Idempotent. */
  stop(): { ok: true } {
    if (!this.session) return { ok: true };
    for (const w of this.session.watchers.values()) {
      try {
        w.close();
      } catch {
        /* watcher already closed */
      }
    }
    if (this.session.timer) clearTimeout(this.session.timer);
    this.session = null;
    this.refcounts.clear();
    return { ok: true };
  }

  private addDir(dir: string): void {
    const name = dir.split("/").filter(Boolean).pop() ?? "";
    if (name && isSkippedName(name)) return;
    const session = this.session;
    if (!session) return;
    const current = this.refcounts.get(dir) ?? 0;
    if (current > 0) {
      this.refcounts.set(dir, current + 1);
      return;
    }
    let watcher: FSWatcher;
    try {
      watcher = this.watchFn(dir, (_event, filename) =>
        this.onEvent(dir, filename)
      );
    } catch {
      // A dir can vanish between listing and watching; skip silently.
      return;
    }
    watcher.on?.("error", () => {
      /* transient watcher errors must not crash the sidecar */
    });
    session.watchers.set(dir, watcher);
    this.refcounts.set(dir, 1);
  }

  private removeDir(dir: string): void {
    const session = this.session;
    if (!session) return;
    const current = this.refcounts.get(dir) ?? 0;
    if (current <= 1) {
      this.refcounts.delete(dir);
      // Last requester released: close the FSWatcher so the OS handle is freed
      // on collapse/remove rather than leaking until the session is torn down.
      const watcher = session.watchers.get(dir);
      if (watcher) {
        try {
          watcher.close();
        } catch {
          /* watcher already closed */
        }
        session.watchers.delete(dir);
      }
    } else {
      this.refcounts.set(dir, current - 1);
    }
  }

  private onEvent(dir: string, filename: string | null): void {
    const session = this.session;
    if (!session) return;
    const name = filename ?? "";
    // Drop noise from skipped subdirs even when the parent is watched.
    if (name && isSkippedName(name)) return;
    const full = name ? `${dir}/${name}` : dir;
    session.pending.add(full);
    if (session.batchStart === null) session.batchStart = this.now();
    this.schedule();
  }

  private schedule(): void {
    const session = this.session;
    if (!session) return;
    if (session.timer) clearTimeout(session.timer);
    const elapsed = this.now() - (session.batchStart ?? this.now());
    const remaining = Math.max(0, this.maxWindowMs - elapsed);
    const delay = Math.min(this.debounceMs, remaining);
    session.timer = setTimeout(() => this.flush(), delay);
  }

  private flush(): void {
    const session = this.session;
    if (!session) return;
    session.timer = null;
    session.batchStart = null;
    if (session.pending.size === 0) return;
    const paths = [...session.pending];
    session.pending.clear();
    emit(this.notifier, "fs.changed", { root: session.root, paths });
  }
}
