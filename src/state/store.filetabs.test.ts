import { beforeEach, describe, expect, it } from "vitest";
import { useWorkbench, fileTabId } from "./store";

function open(input: Partial<Parameters<ReturnType<typeof useWorkbench.getState>["openFileTab"]>[0]> = {}) {
  useWorkbench.getState().openFileTab({
    kind: "file",
    path: "/wt/src/a.ts",
    worktreePath: "/wt",
    preview: true,
    ...input,
  });
}

describe("FileTab store", () => {
  beforeEach(() => {
    useWorkbench.setState({
      fileTabs: [],
      activeFileTabId: null,
      activeWorkspaceId: null,
      activeSystemTab: null,
    });
  });

  it("fileTabId is stable per kind+path", () => {
    expect(fileTabId("file", "/wt/a.ts")).toBe("file:/wt/a.ts");
    expect(fileTabId("diff", "/wt/a.ts")).not.toBe(fileTabId("file", "/wt/a.ts"));
  });

  it("openFileTab adds a preview tab and activates it", () => {
    open();
    const s = useWorkbench.getState();
    expect(s.fileTabs).toHaveLength(1);
    expect(s.fileTabs[0]).toMatchObject({
      kind: "file", path: "/wt/src/a.ts", preview: true, dirty: false, mode: "edit",
    });
    expect(s.activeFileTabId).toBe(s.fileTabs[0].id);
    expect(s.activeWorkspaceId).toBeNull();
  });

  it("a second preview open REPLACES the existing preview tab in place", () => {
    open();
    open({ path: "/wt/src/b.ts" });
    const s = useWorkbench.getState();
    expect(s.fileTabs).toHaveLength(1);
    expect(s.fileTabs[0].path).toBe("/wt/src/b.ts");
  });

  it("pinned tabs are never replaced by preview opens", () => {
    open({ preview: false });
    open({ path: "/wt/src/b.ts" });
    const s = useWorkbench.getState();
    expect(s.fileTabs).toHaveLength(2);
  });

  it("re-opening the same path with preview:false pins the existing tab", () => {
    open();
    open({ preview: false });
    const s = useWorkbench.getState();
    expect(s.fileTabs).toHaveLength(1);
    expect(s.fileTabs[0].preview).toBe(false);
  });

  it("marking dirty pins the tab", () => {
    open();
    useWorkbench.getState().setFileTabDirty(useWorkbench.getState().fileTabs[0].id, true);
    const tab = useWorkbench.getState().fileTabs[0];
    expect(tab.dirty).toBe(true);
    expect(tab.preview).toBe(false);
  });

  it("closeFileTab removes a clean tab and returns true", () => {
    open();
    const id = useWorkbench.getState().fileTabs[0].id;
    expect(useWorkbench.getState().closeFileTab(id)).toBe(true);
    expect(useWorkbench.getState().fileTabs).toHaveLength(0);
    expect(useWorkbench.getState().activeFileTabId).toBeNull();
  });

  it("closeFileTab blocks a dirty tab unless forced", () => {
    open();
    const id = useWorkbench.getState().fileTabs[0].id;
    useWorkbench.getState().setFileTabDirty(id, true);
    expect(useWorkbench.getState().closeFileTab(id)).toBe(false);
    expect(useWorkbench.getState().fileTabs).toHaveLength(1);
    expect(useWorkbench.getState().closeFileTab(id, { force: true })).toBe(true);
    expect(useWorkbench.getState().fileTabs).toHaveLength(0);
  });

  it("setFileTabMode and setFileTabViewer update the tab", () => {
    open({ kind: "diff", mode: "diff" });
    const id = useWorkbench.getState().fileTabs[0].id;
    useWorkbench.getState().setFileTabMode(id, "edit");
    useWorkbench.getState().setFileTabViewer(id, "hex");
    expect(useWorkbench.getState().fileTabs[0]).toMatchObject({ mode: "edit", viewerId: "hex" });
  });

  it("setFileTabViewer and setFileTabViewed leave non-matching tabs unchanged (false branch of map ternary)", () => {
    // Open two tabs so the map ternary hits both branches: matching and non-matching.
    open({ path: "/wt/src/a.ts", kind: "file", preview: false });
    open({ path: "/wt/src/b.ts", kind: "diff", mode: "diff", preview: false });
    const [tab0, tab1] = useWorkbench.getState().fileTabs;
    useWorkbench.getState().setFileTabViewer(tab0.id, "code-viewer");
    expect(useWorkbench.getState().fileTabs[0].viewerId).toBe("code-viewer");
    // tab1 must NOT have been touched.
    expect(useWorkbench.getState().fileTabs[1].viewerId).toBeUndefined();

    useWorkbench.getState().setFileTabViewed(tab1.id, true);
    expect(useWorkbench.getState().fileTabs[1].viewed).toBe(true);
    // tab0 must NOT have been touched.
    expect(useWorkbench.getState().fileTabs[0].viewed).toBe(false);
  });

  it("activating a workspace clears the active file tab and vice versa", () => {
    open();
    useWorkbench.getState().setActiveWorkspace("ws-1");
    expect(useWorkbench.getState().activeFileTabId).toBeNull();
    useWorkbench.getState().setActiveFileTab(useWorkbench.getState().fileTabs[0].id);
    expect(useWorkbench.getState().activeWorkspaceId).toBeNull();
  });

  it("opening a system tab clears the active file tab", () => {
    open();
    useWorkbench.getState().openSystemTab("kanban");
    expect(useWorkbench.getState().activeFileTabId).toBeNull();
  });

  it("setFileTabViewed marks a diff tab as viewed", () => {
    open({ kind: "diff", mode: "diff" });
    const id = useWorkbench.getState().fileTabs[0].id;
    useWorkbench.getState().setFileTabViewed(id, true);
    expect(useWorkbench.getState().fileTabs[0].viewed).toBe(true);
  });

  it("pinFileTab sets preview to false", () => {
    open();
    const id = useWorkbench.getState().fileTabs[0].id;
    useWorkbench.getState().pinFileTab(id);
    expect(useWorkbench.getState().fileTabs[0].preview).toBe(false);
  });

  it("openFileTab stamps the owning workspaceId from worktreePath", () => {
    useWorkbench.setState({
      workspaces: [{ id: "w1", projectId: "p", branch: "b", agentBackend: "claude", worktreePath: "/wt/w1", status: "active", sessionId: "s" }],
      fileTabs: [], activeFileTabId: null, fileTabAccessOrder: [],
    });
    useWorkbench.getState().openFileTab({ kind: "file", path: "/wt/w1/a.ts", worktreePath: "/wt/w1", preview: true });
    const tab = useWorkbench.getState().fileTabs[0];
    expect(tab.workspaceId).toBe("w1");
  });

  it("openFileTab sets workspaceId null when no workspace matches", () => {
    useWorkbench.setState({ workspaces: [], fileTabs: [], activeFileTabId: null, fileTabAccessOrder: [] });
    useWorkbench.getState().openFileTab({ kind: "file", path: "/x/a.ts", worktreePath: "/x", preview: true });
    expect(useWorkbench.getState().fileTabs[0].workspaceId).toBeNull();
  });
});
