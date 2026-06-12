import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useWorkbench } from "@/state/store";
import { viewerRegistry } from "@/lib/viewers";
import { invoke } from "@tauri-apps/api/core";
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
});
