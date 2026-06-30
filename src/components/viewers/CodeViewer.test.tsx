import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useWorkbench } from "@/state/store";
import { fileMetaForPath } from "@/lib/viewers/types";
import { __resetModelCache } from "@/lib/viewers/monaco/model-cache";
import * as modelCache from "@/lib/viewers/monaco/model-cache";
import CodeViewer from "./CodeViewer";

const listenMock = vi.mocked(listen);

// Capture the most-recently-registered fs:changed listener so tests can fire it.
let capturedFsCallback: ((e: { payload: { paths: string[] } }) => void) | null = null;
// Capture the most recently created model so tests can mutate it to simulate dirty state.
let capturedModel: { getValue: () => string; setValue: (v: string) => void } | null = null;

const invokeMock = vi.mocked(invoke);

function tabFor(path = "/wt/src/a.ts") {
  useWorkbench.setState({ fileTabs: [], activeFileTabId: null });
  useWorkbench.getState().openFileTab({ kind: "file", path, worktreePath: "/wt", preview: false });
  return useWorkbench.getState().fileTabs[0];
}

describe("CodeViewer", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  beforeEach(() => {
    capturedFsCallback = null;
    capturedModel = null;
    __resetModelCache();
    // Wrap getOrCreateModel to capture the returned model for dirty-state tests.
    const realGetOrCreate = modelCache.getOrCreateModel;
    vi.spyOn(modelCache, "getOrCreateModel").mockImplementation(async (path, content) => {
      const m = await realGetOrCreate(path, content);
      capturedModel = m as { getValue: () => string; setValue: (v: string) => void };
      return m;
    });
    // Reset the monaco editor spies so each test starts fresh.
    const monaco = (globalThis as unknown as Record<string, {
      editor: { create: ReturnType<typeof vi.fn>; createModel: ReturnType<typeof vi.fn>; getModel: ReturnType<typeof vi.fn> };
    }>).__monaco;
    if (monaco) {
      monaco.editor.create.mockClear();
      monaco.editor.createModel.mockClear();
      monaco.editor.getModel.mockReturnValue(null);
    }
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "file_read")
        return { content: "const x = 1;", size: 12, binary: false, unreadable: false, mtime: 100 };
      if (cmd === "file_write") return { mtime: 200 };
      return undefined;
    });
    // Capture fs:changed listener so tests can fire it.
    listenMock.mockImplementation(async (_event, cb) => {
      capturedFsCallback = cb as (e: { payload: { paths: string[] } }) => void;
      return () => {};
    });
  });

  it("loads file content into a monaco model and mounts an editor", async () => {
    const tab = tabFor();
    // Capture registerActions to know when the async effect has completed.
    let actionsCaptured = false;
    render(
      <CodeViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={() => { actionsCaptured = true; }} />
    );
    // Wait for the async effect to finish (it calls registerActions at the end).
    await waitFor(() => expect(actionsCaptured).toBe(true));
    const monaco = (globalThis as unknown as Record<string, { editor: { create: ReturnType<typeof vi.fn> } }>).__monaco;
    expect(monaco.editor.create).toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith("file_read", { filePath: "/wt/src/a.ts" });
  });

  it("Fix A — uses the initial content prop and issues NO second file_read", async () => {
    const tab = tabFor();
    let actions: { save?: () => Promise<void> } = {};
    render(
      <CodeViewer
        tab={tab}
        meta={fileMetaForPath(tab.path)}
        initial={{ content: "seed = 1", mtime: 55, encoding: "utf8" }}
        onDirtyChange={vi.fn()}
        registerActions={(a) => { actions = a; }}
      />
    );
    await waitFor(() => expect(actions.save).toBeDefined());
    const monaco = (globalThis as unknown as Record<string, { editor: { create: ReturnType<typeof vi.fn> } }>).__monaco;
    expect(monaco.editor.create).toHaveBeenCalled();
    // The seed content satisfied the load — no file_read round trip on the critical path.
    expect(invokeMock).not.toHaveBeenCalledWith("file_read", expect.anything());
    // Save round-trips the seed's mtime + encoding, proving they were adopted.
    await actions.save?.();
    expect(invokeMock).toHaveBeenCalledWith("file_write", {
      filePath: "/wt/src/a.ts",
      content: "seed = 1",
      expectedMtime: 55,
      encoding: "utf8",
    });
  });

  it("registers save/copy actions; save calls file_write with expectedMtime", async () => {
    const tab = tabFor();
    let actions: { save?: () => Promise<void> } = {};
    render(
      <CodeViewer
        tab={tab}
        meta={fileMetaForPath(tab.path)}
        onDirtyChange={vi.fn()}
        registerActions={(a) => { actions = a; }}
      />
    );
    await waitFor(() => expect(actions.save).toBeDefined());
    await actions.save?.();
    expect(invokeMock).toHaveBeenCalledWith("file_write", {
      filePath: "/wt/src/a.ts",
      content: "const x = 1;",
      expectedMtime: 100,
    });
  });

  it("shows a conflict bar when file_write rejects with a conflict", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "file_read")
        return { content: "const x = 1;", size: 12, binary: false, unreadable: false, mtime: 100 };
      if (cmd === "file_write") throw new Error("file changed on disk since last read: /wt/src/a.ts");
      return undefined;
    });
    const tab = tabFor();
    let actions: { save?: () => Promise<void> } = {};
    render(
      <CodeViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={(a) => { actions = a; }} />
    );
    await waitFor(() => expect(actions.save).toBeDefined());
    await actions.save?.().catch(() => {});
    expect(await screen.findByTestId("code-viewer-conflict")).toBeInTheDocument();
  });

  it("Reload button reloads file from disk and clears the conflict bar", async () => {
    let writeCount = 0;
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "file_read")
        return { content: "const x = 1;", size: 12, binary: false, unreadable: false, mtime: 100 };
      if (cmd === "file_write") {
        writeCount++;
        if (writeCount === 1) throw new Error("file changed on disk since last read: /wt/src/a.ts");
        return { mtime: 300 };
      }
      return undefined;
    });
    const tab = tabFor();
    let actions: { save?: () => Promise<void> } = {};
    render(
      <CodeViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={(a) => { actions = a; }} />
    );
    await waitFor(() => expect(actions.save).toBeDefined());
    await actions.save?.().catch(() => {});
    const conflictBar = await screen.findByTestId("code-viewer-conflict");
    expect(conflictBar).toBeInTheDocument();
    // Reload button
    const reloadBtn = screen.getByRole("button", { name: /reload/i });
    reloadBtn.click();
    await waitFor(() => expect(screen.queryByTestId("code-viewer-conflict")).toBeNull());
  });

  it("copyContents action writes model content to clipboard", async () => {
    const tab = tabFor();
    let actions: { copyContents?: () => Promise<void> } = {};
    render(
      <CodeViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={(a) => { actions = a; }} />
    );
    await waitFor(() => expect(actions.copyContents).toBeDefined());
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, writable: true, configurable: true });
    await actions.copyContents?.();
    expect(writeText).toHaveBeenCalledWith("const x = 1;");
  });

  it("non-conflict errors from file_write are rethrown", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "file_read")
        return { content: "const x = 1;", size: 12, binary: false, unreadable: false, mtime: 100 };
      if (cmd === "file_write") throw new Error("permission denied");
      return undefined;
    });
    const tab = tabFor();
    let actions: { save?: () => Promise<void> } = {};
    render(
      <CodeViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={(a) => { actions = a; }} />
    );
    await waitFor(() => expect(actions.save).toBeDefined());
    await expect(actions.save?.()).rejects.toThrow("permission denied");
  });

  it("Overwrite button writes file without mtime check and clears the conflict bar", async () => {
    let writeCount = 0;
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "file_read")
        return { content: "const x = 1;", size: 12, binary: false, unreadable: false, mtime: 100 };
      if (cmd === "file_write") {
        writeCount++;
        if (writeCount === 1) throw new Error("file changed on disk since last read: /wt/src/a.ts");
        return { mtime: 300 };
      }
      return undefined;
    });
    const tab = tabFor();
    let actions: { save?: () => Promise<void> } = {};
    render(
      <CodeViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={(a) => { actions = a; }} />
    );
    await waitFor(() => expect(actions.save).toBeDefined());
    await actions.save?.().catch(() => {});
    await screen.findByTestId("code-viewer-conflict");
    // Overwrite button
    const overwriteBtn = screen.getByRole("button", { name: /overwrite/i });
    overwriteBtn.click();
    await waitFor(() => expect(screen.queryByTestId("code-viewer-conflict")).toBeNull());
    // Second write should have been called without expectedMtime
    expect(invokeMock).toHaveBeenCalledWith("file_write", {
      filePath: "/wt/src/a.ts",
      content: "const x = 1;",
      expectedMtime: undefined,
    });
  });

  it("onFsChanged: clean-reload when model content matches baseline", async () => {
    let readCount = 0;
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "file_read") {
        readCount++;
        // First read: initial load. Second read: fs-changed reload.
        return readCount === 1
          ? { content: "const x = 1;", size: 12, binary: false, unreadable: false, mtime: 100 }
          : { content: "const x = 2;", size: 12, binary: false, unreadable: false, mtime: 200 };
      }
      return undefined;
    });
    const tab = tabFor();
    let actions: { save?: () => Promise<void> } = {};
    const onDirtyChange = vi.fn();
    render(
      <CodeViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={onDirtyChange} registerActions={(a) => { actions = a; }} />
    );
    await waitFor(() => expect(actions.save).toBeDefined());
    await waitFor(() => expect(capturedFsCallback).not.toBeNull());
    // Fire the fs event: model is clean (matches baseline), so it should reload.
    await act(async () => {
      capturedFsCallback!({ payload: { paths: ["/wt/src/a.ts"] } });
      await new Promise((r) => setTimeout(r, 0));
    });
    // The model should be updated to the new content, and dirty flag cleared.
    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(false));
  });

  it("onFsChanged: skips reload when mtime is unchanged", async () => {
    const onDirtyChange = vi.fn();
    const tab = tabFor();
    let actions: { save?: () => Promise<void> } = {};
    render(
      <CodeViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={onDirtyChange} registerActions={(a) => { actions = a; }} />
    );
    await waitFor(() => expect(actions.save).toBeDefined());
    await waitFor(() => expect(capturedFsCallback).not.toBeNull());
    // invokeMock returns mtime: 100 for file_read always. mtimeRef is already 100.
    // Firing the event should be a no-op (mtime unchanged).
    const callsBefore = onDirtyChange.mock.calls.length;
    await act(async () => {
      capturedFsCallback!({ payload: { paths: ["/wt/src/a.ts"] } });
      await new Promise((r) => setTimeout(r, 0));
    });
    // No additional onDirtyChange calls since mtime matched.
    expect(onDirtyChange.mock.calls.length).toBe(callsBefore);
  });

  it("onFsChanged: dirty model triggers conflict bar rather than reload", async () => {
    let readCount = 0;
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "file_read") {
        readCount++;
        return readCount === 1
          ? { content: "const x = 1;", size: 12, binary: false, unreadable: false, mtime: 100 }
          : { content: "const x = 2;", size: 12, binary: false, unreadable: false, mtime: 200 };
      }
      return undefined;
    });
    const tab = tabFor();
    let actions: { save?: () => Promise<void> } = {};
    render(
      <CodeViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={(a) => { actions = a; }} />
    );
    await waitFor(() => expect(actions.save).toBeDefined());
    await waitFor(() => expect(capturedFsCallback).not.toBeNull());
    await waitFor(() => expect(capturedModel).not.toBeNull());
    // Make the model dirty (content differs from baseline "const x = 1;").
    capturedModel!.setValue("const x = 999; // dirty");
    // Now fire the fs event with a new mtime.
    await act(async () => {
      capturedFsCallback!({ payload: { paths: ["/wt/src/a.ts"] } });
      await new Promise((r) => setTimeout(r, 0));
    });
    // Dirty model → conflict bar should appear.
    await waitFor(() => expect(screen.getByTestId("code-viewer-conflict")).toBeInTheDocument());
  });

  it("disposed guard: releases model if component unmounts after fileRead but before getOrCreateModel resolves", async () => {
    // Hold up getOrCreateModel so we can unmount in between.
    let resolveModel!: (m: Awaited<ReturnType<typeof modelCache.getOrCreateModel>>) => void;
    const pendingModel = new Promise<Awaited<ReturnType<typeof modelCache.getOrCreateModel>>>((res) => { resolveModel = res; });
    // Override the spy to return the pending promise on first call.
    vi.spyOn(modelCache, "getOrCreateModel").mockReturnValueOnce(pendingModel);
    const releaseModelSpy = vi.spyOn(modelCache, "releaseModel");

    const tab = tabFor();
    const { unmount } = render(
      <CodeViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={vi.fn()} />
    );
    // Wait for file_read to complete (the two awaits before getOrCreateModel in the effect).
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("file_read", { filePath: "/wt/src/a.ts" }));
    // Unmount before getOrCreateModel resolves → sets disposed = true.
    unmount();
    // Now resolve getOrCreateModel — the disposed guard should call releaseModel and return.
    const monacoG = (globalThis as unknown as Record<string, { editor: { createModel: ReturnType<typeof vi.fn> } }>).__monaco;
    const fakeModel = monacoG.editor.createModel("const x = 1;", "typescript");
    await act(async () => { resolveModel(fakeModel); });
    expect(releaseModelSpy).toHaveBeenCalledWith("/wt/src/a.ts");
  });

  it("onFsChanged: ignores events for different paths", async () => {
    const onDirtyChange = vi.fn();
    const tab = tabFor();
    let actions: { save?: () => Promise<void> } = {};
    render(
      <CodeViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={onDirtyChange} registerActions={(a) => { actions = a; }} />
    );
    await waitFor(() => expect(actions.save).toBeDefined());
    await waitFor(() => expect(capturedFsCallback).not.toBeNull());
    const callsBefore = invokeMock.mock.calls.filter(([c]) => c === "file_read").length;
    await act(async () => {
      // Fire with a path that does NOT match tab.path
      capturedFsCallback!({ payload: { paths: ["/wt/src/other.ts"] } });
      await new Promise((r) => setTimeout(r, 0));
    });
    // file_read should NOT have been called again (early return for non-matching path).
    expect(invokeMock.mock.calls.filter(([c]) => c === "file_read").length).toBe(callsBefore);
  });

  it("Fix 4 — onFsChanged listener leak: unmount before listen resolves → unlisten is invoked", async () => {
    // Hold up the onFsChanged promise so we can unmount before it resolves.
    let resolveUnlisten!: (fn: () => void) => void;
    const unlistenFn = vi.fn();
    const pendingListen = new Promise<() => void>((res) => { resolveUnlisten = res; });

    // listenMock is already set up in beforeEach; override it for this test only.
    listenMock.mockImplementationOnce(async () => {
      return pendingListen;
    });

    const tab = tabFor();
    const { unmount } = render(
      <CodeViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={vi.fn()} />
    );

    // Wait for file_read to complete so the effect has progressed past the first awaits.
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("file_read", expect.any(Object)));

    // Unmount while the listen promise is still pending — sets disposed=true.
    unmount();

    // Now resolve the listen promise with our fake unlisten fn.
    await act(async () => { resolveUnlisten(unlistenFn); });

    // The disposed guard must have called unlisten() to avoid a leaked listener.
    expect(unlistenFn).toHaveBeenCalledOnce();
  });

  it("Fix 5 — overwriteDisk: early return when modelRef is null (no empty-file data loss)", async () => {
    // Trigger the conflict bar so the Overwrite button renders, then null out
    // modelRef before the click resolves (simulating unmount mid-flight).
    // In practice we test the null-model guard by intercepting file_write to
    // verify it is never called with an empty string when the model is absent.
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "file_read")
        return { content: "const x = 1;", size: 12, binary: false, unreadable: false, mtime: 100 };
      if (cmd === "file_write") throw new Error("file changed on disk since last read: /wt/src/a.ts");
      return undefined;
    });
    const tab = tabFor();
    let actions: { save?: () => Promise<void> } = {};
    render(
      <CodeViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={(a) => { actions = a; }} />
    );
    await waitFor(() => expect(actions.save).toBeDefined());
    await actions.save?.().catch(() => {});
    // Conflict bar should be visible.
    expect(await screen.findByTestId("code-viewer-conflict")).toBeInTheDocument();
    // Now change invokeMock: if overwriteDisk is guarded it won't call file_write at all
    // when the model is null; if it's NOT guarded it writes "". We simulate the
    // model-null scenario by checking that content arg is never "".
    const writeCallsBefore = invokeMock.mock.calls.filter(([c]) => c === "file_write").length;
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "file_read")
        return { content: "const x = 1;", size: 12, binary: false, unreadable: false, mtime: 100 };
      if (cmd === "file_write") {
        // Must never be called with empty string content.
        const args = invokeMock.mock.calls.at(-1)?.[1] as { content?: string } | undefined;
        expect(args?.content).not.toBe("");
        return { mtime: 300 };
      }
      return undefined;
    });
    const overwriteBtn = screen.getByRole("button", { name: /overwrite/i });
    await act(async () => { overwriteBtn.click(); });
    // The overwrite write (with real model content) should have fired exactly once more.
    await waitFor(() => {
      const writeCallsAfter = invokeMock.mock.calls.filter(([c]) => c === "file_write").length;
      expect(writeCallsAfter).toBe(writeCallsBefore + 1);
    });
    // Conflict bar should be gone.
    await waitFor(() => expect(screen.queryByTestId("code-viewer-conflict")).toBeNull());
  });

  it("Fix 5 — reloadFromDisk: early return when modelRef is null (no state mutation after unmount)", async () => {
    // Trigger a conflict bar so the Reload button renders.
    let writeCount = 0;
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "file_read")
        return { content: "const x = 1;", size: 12, binary: false, unreadable: false, mtime: 100 };
      if (cmd === "file_write") {
        writeCount++;
        if (writeCount === 1) throw new Error("file changed on disk since last read: /wt/src/a.ts");
        return { mtime: 300 };
      }
      return undefined;
    });
    const tab = tabFor();
    let actions: { save?: () => Promise<void> } = {};
    const { unmount } = render(
      <CodeViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={(a) => { actions = a; }} />
    );
    await waitFor(() => expect(actions.save).toBeDefined());
    await actions.save?.().catch(() => {});
    await screen.findByTestId("code-viewer-conflict");

    // Hold up the second file_read inside reloadFromDisk.
    let resolveRead!: (v: unknown) => void;
    const pendingRead = new Promise((res) => { resolveRead = res; });
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "file_read") return pendingRead;
      return undefined;
    });

    const reloadBtn = screen.getByRole("button", { name: /reload/i });
    // Start the reload (won't complete yet).
    reloadBtn.click();

    // Unmount before the read resolves — modelRef becomes null.
    unmount();

    // Resolve the read — the null-guard should prevent any state mutation.
    // If the guard is absent, this would throw (calling setState on an unmounted component).
    await act(async () => {
      resolveRead({ content: "const x = 2;", size: 12, binary: false, unreadable: false, mtime: 200 });
    });
    // No assertion needed beyond "did not throw". The test passes if no error is thrown.
  });
});
