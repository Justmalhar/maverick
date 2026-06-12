import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkbench } from "@/state/store";
import { fileMetaForPath } from "@/lib/viewers/types";
import { __resetModelCache } from "@/lib/viewers/monaco/model-cache";
import DiffViewer from "./DiffViewer";

const invokeMock = vi.mocked(invoke);

function diffTab(path = "/wt/src/a.ts") {
  useWorkbench.setState({ fileTabs: [], activeFileTabId: null });
  useWorkbench.getState().openFileTab({ kind: "diff", path, worktreePath: "/wt", preview: false });
  return useWorkbench.getState().fileTabs[0];
}

describe("DiffViewer", () => {
  beforeEach(() => {
    __resetModelCache();
    // Reset monaco diff editor spy each test.
    const monacoGlobal = (globalThis as Record<string, unknown>).__monaco as {
      editor: { createDiffEditor: ReturnType<typeof vi.fn>; createModel: ReturnType<typeof vi.fn>; getModel: ReturnType<typeof vi.fn> };
    } | undefined;
    if (monacoGlobal) {
      monacoGlobal.editor.createDiffEditor.mockClear();
      monacoGlobal.editor.createModel.mockClear();
      monacoGlobal.editor.getModel.mockReturnValue(null);
    }
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "file_read")
        return { content: "new", size: 3, binary: false, unreadable: false, mtime: 100 };
      if (cmd === "file_read_at_ref") return { content: "old", missing: false };
      if (cmd === "git_discard_file") return { ok: true };
      return undefined;
    });
  });

  it("fetches HEAD content relative to the worktree and mounts a diff editor", async () => {
    const tab = diffTab();
    let actionsCaptured = false;
    render(
      <DiffViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={() => { actionsCaptured = true; }} />
    );
    await waitFor(() => expect(actionsCaptured).toBe(true));
    expect(invokeMock).toHaveBeenCalledWith("file_read_at_ref", {
      worktreePath: "/wt",
      filePath: "src/a.ts",
      ref: "HEAD",
    });
    const monaco = (globalThis as Record<string, { editor: { createDiffEditor: ReturnType<typeof vi.fn> } }>).__monaco;
    expect(monaco.editor.createDiffEditor).toHaveBeenCalled();
  });

  it("registers discardChanges which calls git_discard_file then reloads", async () => {
    const tab = diffTab();
    let actions: { discardChanges?: () => Promise<void> } = {};
    render(
      <DiffViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={(a) => { actions = a; }} />
    );
    await waitFor(() => expect(actions.discardChanges).toBeDefined());
    await actions.discardChanges?.();
    expect(invokeMock).toHaveBeenCalledWith("git_discard_file", {
      worktreePath: "/wt",
      filePath: "src/a.ts",
    });
  });

  it("registers save action that calls file_write with expectedMtime", async () => {
    const tab = diffTab();
    let actions: { save?: () => Promise<void> } = {};
    render(
      <DiffViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={(a) => { actions = a; }} />
    );
    await waitFor(() => expect(actions.save).toBeDefined());
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "file_write") return { mtime: 200 };
      return undefined;
    });
    await actions.save?.();
    expect(invokeMock).toHaveBeenCalledWith("file_write", {
      filePath: "/wt/src/a.ts",
      content: "new",
      expectedMtime: 100,
    });
  });

  it("handles missing-at-HEAD file (added file) with empty original side", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "file_read")
        return { content: "new content", size: 11, binary: false, unreadable: false, mtime: 50 };
      if (cmd === "file_read_at_ref") return { content: "", missing: true };
      return undefined;
    });
    const tab = diffTab("/wt/src/new-file.ts");
    let actionsCaptured = false;
    render(
      <DiffViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={() => { actionsCaptured = true; }} />
    );
    // Should mount without errors even when HEAD version is missing.
    await waitFor(() => expect(actionsCaptured).toBe(true));
    const monaco = (globalThis as Record<string, { editor: { createDiffEditor: ReturnType<typeof vi.fn> } }>).__monaco;
    expect(monaco.editor.createDiffEditor).toHaveBeenCalled();
  });
});
