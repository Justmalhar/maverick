import { useEffect, useRef } from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { useWorkbench } from "@/state/store";
import { viewerRegistry } from "@/lib/viewers";
import { invoke } from "@tauri-apps/api/core";
import type { ViewerProps } from "@/lib/viewers/types";
import FileTabPane from "./FileTabPane";

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
    // register a catch-all test viewer at top priority
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
});
