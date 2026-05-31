import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { FileEntry, FsChangedPayload } from "@/lib/ipc";

const fileTree = vi.fn();
const fsWatchStart = vi.fn().mockResolvedValue({ watching: 1 });
const fsWatchAdd = vi.fn().mockResolvedValue({ watching: 1 });
const fsWatchRemove = vi.fn().mockResolvedValue({ watching: 1 });
const fsWatchStop = vi.fn().mockResolvedValue({ ok: true });
let fsChangedCb: ((p: FsChangedPayload) => void) | null = null;
const unlisten = vi.fn();
const onFsChanged = vi.fn((cb: (p: FsChangedPayload) => void) => {
  fsChangedCb = cb;
  return Promise.resolve(unlisten);
});

vi.mock("@/lib/tauri", () => ({
  fileTree: (...a: unknown[]) => fileTree(...a),
  fsWatchStart: (...a: unknown[]) => fsWatchStart(...a),
  fsWatchAdd: (...a: unknown[]) => fsWatchAdd(...a),
  fsWatchRemove: (...a: unknown[]) => fsWatchRemove(...a),
  fsWatchStop: (...a: unknown[]) => fsWatchStop(...a),
  onFsChanged: (cb: (p: FsChangedPayload) => void) => onFsChanged(cb),
}));

import {
  useFileTree,
  collectDirPaths,
  rememberExpansion,
  recallExpansion,
  absPath,
} from "./useFileTree";

// FileEntry.path is RELATIVE to the worktree root (the sidecar contract); the
// hook joins to ABSOLUTE only at fs.watch.* boundaries.
const tree: FileEntry[] = [
  {
    path: "src",
    name: "src",
    isDirectory: true,
    children: [{ path: "src/a.ts", name: "a.ts", isDirectory: false }],
  },
  { path: "readme.md", name: "readme.md", isDirectory: false },
];

beforeEach(() => {
  fileTree.mockReset().mockResolvedValue(tree);
  fsWatchStart.mockClear();
  fsWatchAdd.mockClear();
  fsWatchRemove.mockClear();
  fsWatchStop.mockClear();
  onFsChanged.mockClear();
  unlisten.mockClear();
  fsChangedCb = null;
});

describe("collectDirPaths", () => {
  it("gathers directory paths recursively", () => {
    const dirs = collectDirPaths(tree);
    expect([...dirs]).toEqual(["src"]);
  });
});

describe("absPath", () => {
  it("joins a relative entry path onto an absolute root", () => {
    expect(absPath("/wt", "src/a.ts")).toBe("/wt/src/a.ts");
  });

  it("does not double-slash when the root ends in a separator", () => {
    expect(absPath("/wt/", "src")).toBe("/wt/src");
  });

  it("returns the bare root for an empty rel", () => {
    expect(absPath("/wt", "")).toBe("/wt");
  });
});

describe("expansion cache", () => {
  it("remembers and recalls per root, evicting beyond the limit", () => {
    rememberExpansion("/root-x", new Set(["/root-x/a"]));
    expect(recallExpansion("/root-x")).toEqual(["/root-x/a"]);
    // Empty set clears the entry.
    rememberExpansion("/root-x", new Set());
    expect(recallExpansion("/root-x")).toEqual([]);
    // Overflow the LRU limit (8) and confirm the oldest is gone.
    for (let i = 0; i < 10; i++) rememberExpansion(`/r${i}`, new Set([`/r${i}/x`]));
    expect(recallExpansion("/r0")).toEqual([]);
    expect(recallExpansion("/r9")).toEqual(["/r9/x"]);
  });
});

describe("useFileTree", () => {
  it("fetches the tree and starts the watcher on mount", async () => {
    const { result } = renderHook(() => useFileTree("/wt"));
    await waitFor(() => expect(result.current.entries.length).toBe(2));
    expect(fsWatchStart).toHaveBeenCalledWith("/wt", []);
    expect(result.current.loading).toBe(false);
  });

  it("does nothing and stops the watcher with a null root", async () => {
    const { result } = renderHook(() => useFileTree(null));
    expect(result.current.entries).toEqual([]);
    await waitFor(() => expect(fsWatchStop).toHaveBeenCalled());
  });

  it("toggle expands (add watch) and collapses (remove watch)", async () => {
    const { result } = renderHook(() => useFileTree("/wt"));
    await waitFor(() => expect(result.current.entries.length).toBe(2));
    // Relative key in `expanded`, absolute (root-joined) path to the watcher.
    act(() => result.current.toggle("src"));
    expect(result.current.expanded.has("src")).toBe(true);
    expect(fsWatchAdd).toHaveBeenCalledWith(["/wt/src"]);
    act(() => result.current.toggle("src"));
    expect(result.current.expanded.has("src")).toBe(false);
    expect(fsWatchRemove).toHaveBeenCalledWith(["/wt/src"]);
  });

  it("refresh refetches the active root", async () => {
    const { result } = renderHook(() => useFileTree("/wt"));
    await waitFor(() => expect(result.current.entries.length).toBe(2));
    fileTree.mockClear();
    act(() => result.current.refresh());
    await waitFor(() => expect(fileTree).toHaveBeenCalledWith("/wt"));
  });

  it("refresh is a no-op with no root", async () => {
    const { result } = renderHook(() => useFileTree(null));
    fileTree.mockClear();
    act(() => result.current.refresh());
    expect(fileTree).not.toHaveBeenCalled();
  });

  it("fs:changed for the active root triggers a refetch", async () => {
    const { result } = renderHook(() => useFileTree("/wt"));
    await waitFor(() => expect(result.current.entries.length).toBe(2));
    fileTree.mockClear();
    act(() => fsChangedCb?.({ root: "/wt", paths: ["/wt/x.ts"] }));
    await waitFor(() => expect(fileTree).toHaveBeenCalled());
  });

  it("fs:changed matched by path prefix triggers a refetch", async () => {
    const { result } = renderHook(() => useFileTree("/wt"));
    await waitFor(() => expect(result.current.entries.length).toBe(2));
    fileTree.mockClear();
    act(() => fsChangedCb?.({ root: "/other", paths: ["/wt/deep/x.ts"] }));
    await waitFor(() => expect(fileTree).toHaveBeenCalled());
  });

  it("fs:changed for an unrelated root is ignored", async () => {
    const { result } = renderHook(() => useFileTree("/wt"));
    await waitFor(() => expect(result.current.entries.length).toBe(2));
    fileTree.mockClear();
    act(() => fsChangedCb?.({ root: "/other", paths: ["/other/x.ts"] }));
    // No refetch.
    expect(fileTree).not.toHaveBeenCalled();
  });

  it("prunes expansion and watch state for vanished directories", async () => {
    const { result } = renderHook(() => useFileTree("/wt"));
    await waitFor(() => expect(result.current.entries.length).toBe(2));
    act(() => result.current.toggle("src"));
    expect(result.current.expanded.has("src")).toBe(true);
    fsWatchRemove.mockClear();
    // Next fetch returns a tree without the "src" dir.
    fileTree.mockResolvedValue([{ path: "readme.md", name: "readme.md", isDirectory: false }]);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.expanded.has("src")).toBe(false));
    // The vanished dir is released by its ABSOLUTE (root-joined) path.
    expect(fsWatchRemove).toHaveBeenCalledWith(["/wt/src"]);
  });

  it("clears entries when the fetch rejects", async () => {
    fileTree.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useFileTree("/wt"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toEqual([]);
  });

  it("restores cached expansion when remounting the same root", async () => {
    // Expansion cache holds RELATIVE keys; fs.watch.start receives ABSOLUTE.
    rememberExpansion("/wt2", new Set(["src"]));
    fileTree.mockResolvedValue([
      { path: "src", name: "src", isDirectory: true, children: [] },
    ]);
    const { result } = renderHook(() => useFileTree("/wt2"));
    await waitFor(() => expect(result.current.expanded.has("src")).toBe(true));
    expect(fsWatchStart).toHaveBeenCalledWith("/wt2", ["/wt2/src"]);
  });

  it("unlistens immediately when the listener resolves after unmount", async () => {
    // Defer the onFsChanged promise so it settles only after we unmount; the
    // late-resolution path must call the unlisten function it received.
    let resolveListen: (un: () => void) => void = () => {};
    onFsChanged.mockImplementationOnce(((cb: (p: FsChangedPayload) => void) => {
      fsChangedCb = cb;
      return new Promise<() => void>((res) => {
        resolveListen = res;
      });
    }) as never);
    const lateUnlisten = vi.fn();
    const { unmount } = renderHook(() => useFileTree("/wt"));
    await waitFor(() => expect(onFsChanged).toHaveBeenCalled());
    unmount();
    act(() => resolveListen(lateUnlisten));
    await waitFor(() => expect(lateUnlisten).toHaveBeenCalled());
  });

  it("toggle of an already-watched dir does not re-add the watch", async () => {
    rememberExpansion("/wt3", new Set(["src"]));
    fileTree.mockResolvedValue([
      { path: "src", name: "src", isDirectory: true, children: [] },
    ]);
    const { result } = renderHook(() => useFileTree("/wt3"));
    await waitFor(() => expect(result.current.expanded.has("src")).toBe(true));
    fsWatchAdd.mockClear();
    // Collapse then expand again; the second expand re-adds the watch (absolute)
    // since the collapse removed it.
    act(() => result.current.toggle("src"));
    act(() => result.current.toggle("src"));
    expect(fsWatchAdd).toHaveBeenCalledWith(["/wt3/src"]);
  });

  it("watches an ABSOLUTE root-joined path on expand, never a bare rel", async () => {
    // Finding P2-A #1: fs.watch.add must receive the OS-absolute dir, not the
    // relative tree segment, or the sidecar watches the wrong (or no) path.
    fileTree.mockResolvedValue([
      {
        path: "src/nested",
        name: "nested",
        isDirectory: true,
        children: [],
      },
    ]);
    const { result } = renderHook(() => useFileTree("/Users/me/project"));
    await waitFor(() => expect(result.current.entries.length).toBe(1));
    act(() => result.current.toggle("src/nested"));
    expect(fsWatchAdd).toHaveBeenCalledWith(["/Users/me/project/src/nested"]);
    // Never the bare relative segment.
    expect(fsWatchAdd).not.toHaveBeenCalledWith(["src/nested"]);
  });

  it("detaches the fs.changed listener before stopping the watcher on switch", async () => {
    // Finding P2-A #5: on workspace switch the listener must be removed before
    // (and along with) fs.watch.stop, so a late event cannot schedule a refetch
    // against a stale root. Assert unlisten runs and then the watcher stops.
    const order: string[] = [];
    unlisten.mockImplementation(() => order.push("unlisten"));
    fsWatchStop.mockImplementation(() => {
      order.push("stop");
      return Promise.resolve({ ok: true });
    });
    const { rerender, unmount } = renderHook(({ root }) => useFileTree(root), {
      initialProps: { root: "/wt-a" as string | null },
    });
    await waitFor(() => expect(onFsChanged).toHaveBeenCalled());
    rerender({ root: "/wt-b" });
    await waitFor(() => expect(order).toContain("stop"));
    expect(order.indexOf("unlisten")).toBeLessThan(order.indexOf("stop"));
    unmount();
  });
});
