import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkbench } from "@/state/store";
import { fileMetaForPath } from "@/lib/viewers/types";
import { __resetModelCache } from "@/lib/viewers/monaco/model-cache";
import * as modelCache from "@/lib/viewers/monaco/model-cache";
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
    const monacoGlobal = (globalThis as unknown as Record<string, {
      editor: { createDiffEditor: ReturnType<typeof vi.fn>; createModel: ReturnType<typeof vi.fn>; getModel: ReturnType<typeof vi.fn> };
    } | undefined>).__monaco;
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
    const monaco = (globalThis as unknown as Record<string, { editor: { createDiffEditor: ReturnType<typeof vi.fn> } }>).__monaco;
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
    const monaco = (globalThis as unknown as Record<string, { editor: { createDiffEditor: ReturnType<typeof vi.fn> } }>).__monaco;
    expect(monaco.editor.createDiffEditor).toHaveBeenCalled();
  });

  it("relPath returns full path when path does not start with worktreePath", async () => {
    // Use a path outside the worktree to exercise the else branch of relPath.
    const tab = diffTab("/other/absolute/path.ts");
    // Override worktreePath to something that doesn't match the path prefix.
    const overrideTab = { ...tab, path: "/other/absolute/path.ts", worktreePath: "/wt" };
    let actionsCaptured = false;
    render(
      <DiffViewer tab={overrideTab} meta={fileMetaForPath(overrideTab.path)} onDirtyChange={vi.fn()} registerActions={() => { actionsCaptured = true; }} />
    );
    await waitFor(() => expect(actionsCaptured).toBe(true));
    // file_read_at_ref should have been called with the full path (else branch of relPath).
    expect(invokeMock).toHaveBeenCalledWith("file_read_at_ref", {
      worktreePath: "/wt",
      filePath: "/other/absolute/path.ts",
      ref: "HEAD",
    });
  });

  it("copyContents action writes modified content to clipboard", async () => {
    const tab = diffTab();
    let actions: { copyContents?: () => Promise<void> } = {};
    render(
      <DiffViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={(a) => { actions = a; }} />
    );
    await waitFor(() => expect(actions.copyContents).toBeDefined());
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, writable: true, configurable: true });
    await actions.copyContents?.();
    expect(writeText).toHaveBeenCalledWith("new");
  });

  it("disposes original model and releases cache if component unmounts after getOrCreateModel resolves", async () => {
    // Delay getOrCreateModel to allow unmount to happen in between.
    let resolveModel!: (v: ReturnType<typeof modelCache.getOrCreateModel> extends Promise<infer T> ? T : never) => void;
    const modelPromise = new Promise<Awaited<ReturnType<typeof modelCache.getOrCreateModel>>>((res) => { resolveModel = res; });
    const getOrCreateSpy = vi.spyOn(modelCache, "getOrCreateModel").mockReturnValueOnce(modelPromise);
    const releaseModelSpy = vi.spyOn(modelCache, "releaseModel");

    const tab = diffTab();
    const { unmount } = render(
      <DiffViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={vi.fn()} />
    );

    // Wait for the initial file_read / file_read_at_ref to complete, then unmount
    // before getOrCreateModel resolves — this sets disposed=true.
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("file_read_at_ref", expect.any(Object)));
    unmount();

    // Now resolve getOrCreateModel with a fake model — the disposed guard should
    // call original.dispose() and releaseModel(path) without creating the editor.
    const monaco = (globalThis as unknown as Record<string, { editor: { createModel: ReturnType<typeof vi.fn>; getModel: ReturnType<typeof vi.fn> } }>).__monaco;
    const fakeModel = monaco.editor.createModel("new", "typescript");
    await act(async () => { resolveModel(fakeModel); });

    // releaseModel must have been called EXACTLY once — from the disposed guard path.
    // The cleanup return() only calls releaseModel when acquired===true, which is false
    // here because the guard returned early before setting acquired. No double-release.
    expect(releaseModelSpy).toHaveBeenCalledTimes(1);
    expect(releaseModelSpy).toHaveBeenCalledWith("/wt/src/a.ts");

    getOrCreateSpy.mockRestore();
    releaseModelSpy.mockRestore();
  });
});
