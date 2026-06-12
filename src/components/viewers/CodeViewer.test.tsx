import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkbench } from "@/state/store";
import { fileMetaForPath } from "@/lib/viewers/types";
import { __resetModelCache } from "@/lib/viewers/monaco/model-cache";
import CodeViewer from "./CodeViewer";

const invokeMock = vi.mocked(invoke);

function tabFor(path = "/wt/src/a.ts") {
  useWorkbench.setState({ fileTabs: [], activeFileTabId: null });
  useWorkbench.getState().openFileTab({ kind: "file", path, worktreePath: "/wt", preview: false });
  return useWorkbench.getState().fileTabs[0];
}

describe("CodeViewer", () => {
  beforeEach(() => {
    __resetModelCache();
    // Reset the monaco editor spies so each test starts fresh.
    const monaco = (globalThis as Record<string, unknown>).__monaco as {
      editor: { create: ReturnType<typeof vi.fn>; createModel: ReturnType<typeof vi.fn>; getModel: ReturnType<typeof vi.fn> };
    };
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
    const monaco = (globalThis as Record<string, { editor: { create: ReturnType<typeof vi.fn> } }>).__monaco;
    expect(monaco.editor.create).toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith("file_read", { filePath: "/wt/src/a.ts" });
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
});
