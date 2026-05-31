// Live file-tree state for the active worktree: fetches the recursive tree,
// watches expanded directories for changes (coalesced in the sidecar), restores
// expansion per-root via an LRU cache, and prunes expansion/watch state for
// directories that disappear after a refetch.
//
// Path convention: the sidecar returns FileEntry.path as RELATIVE to the
// worktree root (git-porcelain status mapping depends on this). Expansion and
// watch bookkeeping are therefore keyed by RELATIVE path, but every fs.watch.*
// call crosses an OS boundary and so is passed an ABSOLUTE dir (root-joined).
// The watcher root itself is absolute.
import { useCallback, useEffect, useRef, useState } from "react";
import { fileTree, fsWatchStart, fsWatchAdd, fsWatchRemove, fsWatchStop, onFsChanged } from "@/lib/tauri";
import type { FileEntry } from "@/lib/ipc";

// Joins an absolute worktree root with a forward-slash relative entry path,
// collapsing a trailing/leading separator so we never emit a double slash. An
// empty rel (the root itself) resolves to the bare root.
export function absPath(root: string, rel: string): string {
  if (rel === "") return root;
  const base = root.endsWith("/") ? root.slice(0, -1) : root;
  return `${base}/${rel}`;
}

const EXPANSION_CACHE_LIMIT = 8;
// Module-scoped so expansion survives unmount/remount of the explorer (e.g.
// switching workspaces and back). LRU-evicted to bound memory.
const expansionCache = new Map<string, string[]>();

export function rememberExpansion(root: string, expanded: Set<string>): void {
  expansionCache.delete(root);
  if (expanded.size > 0) expansionCache.set(root, [...expanded]);
  while (expansionCache.size > EXPANSION_CACHE_LIMIT) {
    const oldest = expansionCache.keys().next().value;
    if (oldest === undefined) break;
    expansionCache.delete(oldest);
  }
}

export function recallExpansion(root: string): string[] {
  const v = expansionCache.get(root);
  if (!v) return [];
  // Touch on read so the active root is the most-recently-used entry.
  expansionCache.delete(root);
  expansionCache.set(root, v);
  return v;
}

export function collectDirPaths(entries: FileEntry[], acc: Set<string> = new Set()): Set<string> {
  for (const e of entries) {
    if (e.isDirectory) {
      acc.add(e.path);
      if (e.children) collectDirPaths(e.children, acc);
    }
  }
  return acc;
}

export interface UseFileTreeResult {
  entries: FileEntry[];
  expanded: Set<string>;
  loading: boolean;
  toggle: (path: string) => void;
  refresh: () => void;
}

export function useFileTree(rootPath: string | null): UseFileTreeResult {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const expandedRef = useRef(expanded);
  const watchedRef = useRef<Set<string>>(new Set());
  const rootRef = useRef<string | null>(rootPath);

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  const fetchTree = useCallback(async (root: string) => {
    setLoading(true);
    try {
      const list = await fileTree(root);
      if (rootRef.current !== root) return;
      // liveDirs holds RELATIVE dir paths, matching FileEntry.path and the
      // relative keys in `expanded`/`watchedRef`.
      const liveDirs = collectDirPaths(list);
      // Prune-on-delete: any expanded/watched dir that no longer exists in the
      // freshly fetched tree is dropped from expansion + its watch released.
      setExpanded((curr) => {
        let changed = false;
        const next = new Set<string>();
        for (const p of curr) {
          if (liveDirs.has(p)) next.add(p);
          else changed = true;
        }
        return changed ? next : curr;
      });
      // The root ("") is never pruned; only vanished relative subdirs are.
      const dead: string[] = [];
      for (const rel of watchedRef.current) {
        if (rel !== "" && !liveDirs.has(rel)) dead.push(rel);
      }
      if (dead.length > 0) {
        for (const d of dead) watchedRef.current.delete(d);
        void fsWatchRemove(dead.map((rel) => absPath(root, rel)));
      }
      setEntries(list);
    } catch {
      if (rootRef.current === root) setEntries([]);
    } finally {
      if (rootRef.current === root) setLoading(false);
    }
  }, []);

  // Root change: persist outgoing expansion, restore cached expansion, attach a
  // single coalesced fs.changed listener scoped to this root, re-scope the
  // sidecar watcher to the new worktree, and fetch the tree.
  //
  // Teardown ordering matters: we detach the listener BEFORE (and independently
  // of) stopping the watcher, so a late `fs.changed` cannot land after stop and
  // schedule a refetch against a now-stale root. The listener subscription is
  // async, so we guard against late resolution after unmount.
  useEffect(() => {
    rootRef.current = rootPath;
    // `watchedRef` holds RELATIVE dir paths; "" denotes the watcher root. Every
    // fs.watch.* call below joins these to ABSOLUTE before crossing the OS edge.
    if (!rootPath) {
      setEntries([]);
      setExpanded(new Set());
      void fsWatchStop();
      watchedRef.current.clear();
      return;
    }

    let alive = true;
    let unlisten: (() => void) | undefined;
    const listening = onFsChanged((payload) => {
      const root = rootRef.current;
      if (!root) return;
      if (payload.root === root || payload.paths.some((p) => p.startsWith(root))) {
        void fetchTree(root);
      }
    }).then((un) => {
      if (alive) unlisten = un;
      else un();
      return un;
    });

    const restored = recallExpansion(rootPath);
    setExpanded(new Set(restored));
    // Root is tracked as "" relative; restored dirs are relative too.
    watchedRef.current = new Set<string>(["", ...restored]);
    void fsWatchStart(rootPath, restored.map((rel) => absPath(rootPath, rel)));
    void fetchTree(rootPath);

    return () => {
      rememberExpansion(rootPath, expandedRef.current);
      alive = false;
      // Detach the listener first; only once it can no longer fire do we tear
      // the watcher down. Await both so the stop sequences after the unlisten.
      void listening
        .then((un) => un())
        .catch(() => unlisten?.())
        .finally(() => {
          void fsWatchStop();
        });
      watchedRef.current.clear();
    };
  }, [rootPath, fetchTree]);

  // `path` is a RELATIVE entry path; fs.watch.* receives the ABSOLUTE join.
  const toggle = useCallback((path: string) => {
    const root = rootRef.current;
    setExpanded((curr) => {
      const next = new Set(curr);
      if (next.has(path)) {
        next.delete(path);
        if (watchedRef.current.delete(path) && root) {
          void fsWatchRemove([absPath(root, path)]);
        }
      } else {
        next.add(path);
        if (!watchedRef.current.has(path)) {
          watchedRef.current.add(path);
          if (root) void fsWatchAdd([absPath(root, path)]);
        }
      }
      return next;
    });
  }, []);

  const refresh = useCallback(() => {
    const root = rootRef.current;
    if (root) void fetchTree(root);
  }, [fetchTree]);

  return { entries, expanded, loading, toggle, refresh };
}
