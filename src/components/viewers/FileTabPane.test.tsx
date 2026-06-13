import { useEffect, useRef } from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { useWorkbench } from "@/state/store";
import { viewerRegistry } from "@/lib/viewers";
import { invoke } from "@tauri-apps/api/core";
import type { ViewerProps } from "@/lib/viewers/types";
import * as modelCacheModule from "@/lib/viewers/monaco/model-cache";
import FileTabPane, { lazyViewerCache } from "./FileTabPane";

const invokeMock = vi.mocked(invoke);

function makeTab(path = "/wt/a.zzz") {
  useWorkbench.setState({ fileTabs: [], activeFileTabId: null });
  useWorkbench.getState().openFileTab({ kind: "file", path, worktreePath: "/wt", preview: false });
  return useWorkbench.getState().fileTabs[0];
}

describe("FileTabPane", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({
      content: "hello", size: 5, binary: false, unreadable: false, mtime: 1,
    });
  });

  it("renders the toolbar and the resolved viewer", async () => {
    const tab = makeTab();
    if (!viewerRegistry.get("test-viewer")) {
      viewerRegistry.register({
        id: "test-viewer",
        displayName: "Test",
        priority: 999,
        capabilities: {},
        canHandle: () => true,
        load: async () => () => <div data-testid="test-viewer-body" />,
      });
    }
    render(<FileTabPane tab={tab} active />);
    expect(await screen.findByTestId("viewer-toolbar")).toBeInTheDocument();
    expect(await screen.findByTestId("test-viewer-body")).toBeInTheDocument();
  });

  it("honors tab.viewerId override", async () => {
    const tab = makeTab("/wt/b.zzz");
    if (!viewerRegistry.get("override-viewer")) {
      viewerRegistry.register({
        id: "override-viewer",
        displayName: "Override",
        priority: 0,
        capabilities: {},
        canHandle: () => false, // never resolved organically
        load: async () => () => <div data-testid="override-viewer-body" />,
      });
    }
    useWorkbench.getState().setFileTabViewer(tab.id, "override-viewer");
    render(<FileTabPane tab={useWorkbench.getState().fileTabs[0]} active />);
    expect(await screen.findByTestId("override-viewer-body")).toBeInTheDocument();
  });

  it("renders no-viewer fallback when resolve returns [] and no viewerId set", async () => {
    // Isolate from the real registry singleton (which has a hex catch-all).
    const resolveSpy = vi.spyOn(viewerRegistry, "resolve").mockReturnValue([]);
    try {
      const tab = makeTab("/wt/unknown.xyz");
      render(<FileTabPane tab={tab} active />);
      expect(
        await screen.findByText("No viewer available for this file.")
      ).toBeInTheDocument();
    } finally {
      resolveSpy.mockRestore();
    }
  });

  it("falls back to fileMetaForPath(path) when file_read rejects", async () => {
    invokeMock.mockRejectedValue(new Error("ENOENT"));
    // test-viewer (priority 999, canHandle: () => true) was registered in the
    // first test and will be the top candidate after meta resolves via catch.
    const tab = makeTab("/wt/missing.txt");
    render(<FileTabPane tab={tab} active />);
    // The error path calls fileMetaForPath(path) and then renders a viewer.
    expect(await screen.findByTestId("test-viewer-body")).toBeInTheDocument();
  });

  it("onDirtyChange callback marks the file tab as dirty", async () => {
    // Register a viewer that calls onDirtyChange(true) exactly once after mount.
    // Using a ref avoids re-triggering when onDirtyChange identity changes on
    // each render (the prop is an inline arrow in FileTabPane).
    function DirtyViewer({ onDirtyChange }: ViewerProps) {
      const cbRef = useRef(onDirtyChange);
      cbRef.current = onDirtyChange;
      useEffect(() => { cbRef.current(true); }, []); // empty deps → fires once
      return null;
    }
    if (!viewerRegistry.get("dirty-viewer")) {
      viewerRegistry.register({
        id: "dirty-viewer",
        displayName: "Dirty",
        priority: 1000,
        capabilities: {},
        canHandle: () => true,
        load: async () => DirtyViewer,
      });
    }
    const tab = makeTab("/wt/c.zzz");
    render(<FileTabPane tab={tab} active />);
    // Wait for meta to resolve and the dirty-viewer to mount and call onDirtyChange.
    await waitFor(() =>
      expect(useWorkbench.getState().fileTabs.find((t) => t.id === tab.id)?.dirty).toBe(true)
    );
  });

  it("falls back to highest-priority candidate when tab.viewerId is set to a nonexistent id", async () => {
    // Control both registry methods so the test is isolated from registration order.
    // get("nonexistent-viewer-id") → undefined  (branch: viewerId set but unknown)
    // resolve(...) → single deterministic candidate with a known testid.
    const fallbackDescriptor = {
      id: "fallback-viewer",
      displayName: "Fallback",
      priority: 999,
      capabilities: {},
      canHandle: () => true,
      load: async () => () => <div data-testid="fallback-viewer-body" />,
    };
    const getSpy = vi.spyOn(viewerRegistry, "get").mockReturnValue(undefined);
    const resolveSpy = vi.spyOn(viewerRegistry, "resolve").mockReturnValue([fallbackDescriptor]);
    try {
      const tab = makeTab("/wt/d.zzz");
      useWorkbench.getState().setFileTabViewer(tab.id, "nonexistent-viewer-id");
      // viewerRegistry.get("nonexistent-viewer-id") → undefined → falls through
      // to candidates[0] (fallbackDescriptor from resolveSpy).
      render(<FileTabPane tab={useWorkbench.getState().fileTabs.find((t) => t.id === tab.id)!} active />);
      expect(await screen.findByTestId("fallback-viewer-body")).toBeInTheDocument();
    } finally {
      getSpy.mockRestore();
      resolveSpy.mockRestore();
    }
  });

  it("unmount calls disposeModelForPath for its path (Fix 1 — tab-scoped model lifetime)", async () => {
    const disposeForPathSpy = vi.spyOn(modelCacheModule, "disposeModelForPath");
    const tab = makeTab("/wt/dispose-test.zzz");
    const { unmount } = render(<FileTabPane tab={tab} active />);
    // Wait for the meta-loading effect to complete (toolbar always renders after meta resolves).
    await screen.findByTestId("viewer-toolbar");
    unmount();
    expect(disposeForPathSpy).toHaveBeenCalledWith("/wt/dispose-test.zzz");
    disposeForPathSpy.mockRestore();
  });

  it("onDirtyChange identity is stable — viewer does NOT remount on dirty toggle (Fix 3)", async () => {
    // Register a viewer that: (a) counts mounts, (b) exposes a button that calls
    // onDirtyChange(true) to simulate the editor marking the file dirty.
    let mountSpy = 0;
    const DIRTY_STABLE_ID = "dirty-stable-viewer-fix3";
    function StableDirtyViewer({ onDirtyChange }: ViewerProps) {
      useEffect(() => { mountSpy += 1; }, []);
      return (
        <button data-testid="trigger-dirty" onClick={() => onDirtyChange(true)}>
          Make dirty
        </button>
      );
    }
    if (!viewerRegistry.get(DIRTY_STABLE_ID)) {
      viewerRegistry.register({
        id: DIRTY_STABLE_ID,
        displayName: "StableDirty",
        priority: 0,
        capabilities: {},
        canHandle: () => false, // only reachable via viewerId override
        load: async () => StableDirtyViewer,
      });
    }
    // Clear stale lazy cache entry to ensure this test controls the lifecycle.
    lazyViewerCache.delete(DIRTY_STABLE_ID);
    mountSpy = 0;

    const tab = makeTab("/wt/stable-dirty.zzz");
    useWorkbench.getState().setFileTabViewer(tab.id, DIRTY_STABLE_ID);
    const liveTab = () => useWorkbench.getState().fileTabs.find((t) => t.id === tab.id)!;
    render(<FileTabPane tab={liveTab()} active />);
    const btn = await screen.findByTestId("trigger-dirty");
    expect(mountSpy).toBe(1);

    // Click triggers onDirtyChange(true) → FileTabPane re-renders with dirty state,
    // but onDirtyChange is now stable (useCallback), so the viewer effect does NOT re-run.
    await act(async () => { fireEvent.click(btn); });
    expect(mountSpy).toBe(1); // viewer did NOT remount
  });

  it("lazy viewer component identity is stable per descriptor id across re-renders", async () => {
    // Regression for the lazy()-inside-useMemo remount loop bug.
    // Strategy: render a file tab whose mode toggles (diff→edit→diff) while
    // pointing at the same descriptor id via viewerId override.  The
    // lazyViewerCache must return the identical ComponentType reference each
    // time the same id is requested, so React never unmounts the viewer when
    // merely the descriptor *object* reference changes.
    //
    // Assertion: after two setFileTabViewer calls (same id) the cache still
    // holds exactly one entry for the id, and re-rendering returns the same
    // component reference as the first render.
    const STABLE_ID = "stable-id-viewer";
    let mountCount = 0;
    function StableViewer() {
      useEffect(() => { mountCount += 1; }, []);
      return <div data-testid="stable-viewer-body" />;
    }
    if (!viewerRegistry.get(STABLE_ID)) {
      viewerRegistry.register({
        id: STABLE_ID,
        displayName: "Stable",
        priority: 500,
        capabilities: {},
        canHandle: () => false, // only reachable via viewerId override
        load: async () => StableViewer,
      });
    }
    // Clear any stale cache entry so this test controls the full lifecycle.
    lazyViewerCache.delete(STABLE_ID);

    const tab = makeTab("/wt/e.zzz");
    useWorkbench.getState().setFileTabViewer(tab.id, STABLE_ID);
    const liveTab = () => useWorkbench.getState().fileTabs.find((t) => t.id === tab.id)!;

    const { rerender } = render(<FileTabPane tab={liveTab()} active />);
    await screen.findByTestId("stable-viewer-body");

    // Capture the cached lazy component after first render.
    const firstCachedComponent = lazyViewerCache.get(STABLE_ID);
    expect(firstCachedComponent).toBeDefined();

    // Simulate a state poke (e.g. setFileTabViewed) that causes FileTabPane to
    // re-render — the useMemo for Viewer will re-run if descriptor changes, but
    // the cache must return the same ComponentType identity.
    await act(async () => {
      useWorkbench.getState().setFileTabViewer(tab.id, STABLE_ID);
    });
    rerender(<FileTabPane tab={liveTab()} active />);
    await screen.findByTestId("stable-viewer-body");

    // Cache must not have grown a second entry — same reference returned.
    expect(lazyViewerCache.get(STABLE_ID)).toBe(firstCachedComponent);
    // Viewer must NOT have remounted a second time (mount count stays 1 because
    // React sees the same component type and keeps the subtree alive).
    expect(mountCount).toBe(1);
  });
});
