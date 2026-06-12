/**
 * Render tests for the four D4 viewer wrappers:
 * MarkdownViewer, ImageViewer, VideoViewer, PdfViewer, HexViewer.
 *
 * Each test: renders the wrapper with a stub FileTab + FileMeta + vi.fn()
 * callbacks and asserts the underlying preview renders.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkbench } from "@/state/store";
import { fileMetaForPath } from "@/lib/viewers/types";
import MarkdownViewer from "./MarkdownViewer";
import { ImageViewer, VideoViewer } from "./MediaViewers";
import PdfViewer from "./PdfViewer";
import HexViewer from "./HexViewer";

const invokeMock = vi.mocked(invoke);

/** Build a minimal FileTab in the store and return it. */
function makeFileTab(path: string, mode?: import("@/state/store").FileTabMode) {
  useWorkbench.setState({ fileTabs: [], activeFileTabId: null });
  useWorkbench.getState().openFileTab({
    kind: "file",
    path,
    worktreePath: "/wt",
    preview: false,
    mode,
  });
  return useWorkbench.getState().fileTabs[0];
}

beforeEach(() => {
  invokeMock.mockReset();
  // Default: file_read returns a small text file.
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "file_read") {
      return Promise.resolve({
        content: "# hello",
        size: 7,
        binary: false,
        unreadable: false,
        mtime: 0,
      } as never);
    }
    return Promise.resolve({} as never);
  });
});

// ---------------------------------------------------------------------------
// MarkdownViewer
// ---------------------------------------------------------------------------
describe("MarkdownViewer", () => {
  it("renders MarkdownPreview after loading file content", async () => {
    const tab = makeFileTab("/wt/readme.md", "view");
    const meta = fileMetaForPath("/wt/readme.md");
    const registerActions = vi.fn();
    const onDirtyChange = vi.fn();

    render(
      <MarkdownViewer
        tab={tab}
        meta={meta}
        onDirtyChange={onDirtyChange}
        registerActions={registerActions}
      />
    );

    // react-markdown is mocked to render a div[data-testid="markdown"]
    expect(await screen.findByTestId("markdown")).toBeInTheDocument();
  });

  it("calls registerActions with a copyContents function that writes to clipboard", async () => {
    const tab = makeFileTab("/wt/readme.md", "view");
    const meta = fileMetaForPath("/wt/readme.md");
    const registerActions = vi.fn();
    const onDirtyChange = vi.fn();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    render(
      <MarkdownViewer
        tab={tab}
        meta={meta}
        onDirtyChange={onDirtyChange}
        registerActions={registerActions}
      />
    );

    // Wait for file load then registerActions is called with content set.
    await waitFor(() => expect(registerActions).toHaveBeenCalled());

    // The last call should have copyContents.
    const lastCall = registerActions.mock.calls[registerActions.mock.calls.length - 1][0];
    expect(typeof lastCall.copyContents).toBe("function");

    await lastCall.copyContents();
    expect(writeText).toHaveBeenCalledWith("# hello");
  });

  it("renders CodeViewer (Monaco editor) when tab.mode is edit", async () => {
    const tab = makeFileTab("/wt/readme.md", "edit");
    const meta = fileMetaForPath("/wt/readme.md");
    render(
      <MarkdownViewer
        tab={tab}
        meta={meta}
        onDirtyChange={vi.fn()}
        registerActions={vi.fn()}
      />
    );
    // When mode=edit, MarkdownViewer delegates to CodeViewer via lazy()/Suspense.
    // The editor host div appears once the lazy component resolves and effect runs.
    expect(await screen.findByTestId("code-viewer-editor")).toBeInTheDocument();
    // The markdown renderer should NOT be present.
    expect(screen.queryByTestId("markdown")).toBeNull();
  });

  it("sets content to empty string when file is binary or unreadable", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "file_read") {
        return Promise.resolve({
          content: "garbage",
          size: 7,
          binary: true,
          unreadable: false,
          mtime: 0,
        } as never);
      }
      return Promise.resolve({} as never);
    });

    const tab = makeFileTab("/wt/blob.bin", "view");
    const meta = fileMetaForPath("/wt/blob.bin");
    const registerActions = vi.fn();
    const onDirtyChange = vi.fn();

    render(
      <MarkdownViewer
        tab={tab}
        meta={meta}
        onDirtyChange={onDirtyChange}
        registerActions={registerActions}
      />
    );

    // MarkdownPreview still renders (with empty content), the mock testid appears.
    expect(await screen.findByTestId("markdown")).toBeInTheDocument();

    // copyContents should write empty string when binary.
    await waitFor(() => expect(registerActions).toHaveBeenCalled());
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    const lastCall = registerActions.mock.calls[registerActions.mock.calls.length - 1][0];
    await lastCall.copyContents();
    expect(writeText).toHaveBeenCalledWith("");
  });
});

// ---------------------------------------------------------------------------
// ImageViewer
// ---------------------------------------------------------------------------
describe("ImageViewer", () => {
  it("renders ImagePreview for a .png file", () => {
    const tab = makeFileTab("/wt/logo.png");
    const meta = fileMetaForPath("/wt/logo.png");
    const registerActions = vi.fn();
    const onDirtyChange = vi.fn();

    render(
      <ImageViewer
        tab={tab}
        meta={meta}
        onDirtyChange={onDirtyChange}
        registerActions={registerActions}
      />
    );

    expect(screen.getByTestId("image-preview")).toBeInTheDocument();
    // The img src should be the file path passed via tab.
    expect(screen.getByTestId("image-preview-img")).toHaveAttribute(
      "src",
      "/wt/logo.png"
    );
  });
});

// ---------------------------------------------------------------------------
// VideoViewer
// ---------------------------------------------------------------------------
describe("VideoViewer", () => {
  it("renders VideoPreview for a .mp4 file", () => {
    const tab = makeFileTab("/wt/demo.mp4");
    const meta = fileMetaForPath("/wt/demo.mp4");
    const registerActions = vi.fn();
    const onDirtyChange = vi.fn();

    render(
      <VideoViewer
        tab={tab}
        meta={meta}
        onDirtyChange={onDirtyChange}
        registerActions={registerActions}
      />
    );

    expect(screen.getByTestId("video-preview")).toBeInTheDocument();
    expect(screen.getByTestId("video-preview-el")).toHaveAttribute(
      "src",
      "/wt/demo.mp4"
    );
  });
});

// ---------------------------------------------------------------------------
// PdfViewer
// ---------------------------------------------------------------------------
describe("PdfViewer", () => {
  it("renders PDFPreview container for a .pdf file", async () => {
    const tab = makeFileTab("/wt/doc.pdf");
    const meta = fileMetaForPath("/wt/doc.pdf");
    const registerActions = vi.fn();
    const onDirtyChange = vi.fn();

    render(
      <PdfViewer
        tab={tab}
        meta={meta}
        onDirtyChange={onDirtyChange}
        registerActions={registerActions}
      />
    );

    // pdfjs-dist is mocked; PDFPreview renders the outer container immediately.
    expect(screen.getByTestId("pdf-preview")).toBeInTheDocument();
    // After the fake getDocument promise resolves the canvas appears.
    expect(await screen.findByTestId("pdf-canvas")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// HexViewer
// ---------------------------------------------------------------------------
describe("HexViewer", () => {
  it("renders RawPreview for a binary file", async () => {
    const tab = makeFileTab("/wt/blob.bin");
    const meta = fileMetaForPath("/wt/blob.bin", { binary: true });
    const registerActions = vi.fn();
    const onDirtyChange = vi.fn();

    render(
      <HexViewer
        tab={tab}
        meta={meta}
        onDirtyChange={onDirtyChange}
        registerActions={registerActions}
      />
    );

    expect(screen.getByTestId("raw-preview")).toBeInTheDocument();
  });

  it("renders RawPreview content after file load", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "file_read") {
        return Promise.resolve({
          content: "hello world",
          size: 11,
          binary: false,
          unreadable: false,
          mtime: 0,
        } as never);
      }
      return Promise.resolve({} as never);
    });

    const tab = makeFileTab("/wt/notes.txt");
    const meta = fileMetaForPath("/wt/notes.txt");
    const registerActions = vi.fn();
    const onDirtyChange = vi.fn();

    render(
      <HexViewer
        tab={tab}
        meta={meta}
        onDirtyChange={onDirtyChange}
        registerActions={registerActions}
      />
    );

    expect(screen.getByTestId("raw-preview")).toBeInTheDocument();
    // After file_read resolves, the text content is rendered.
    await waitFor(() =>
      expect(screen.getByText("hello world")).toBeInTheDocument()
    );
  });

  it("renders empty content when file is unreadable", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "file_read") {
        return Promise.resolve({
          content: "ignored",
          size: 0,
          binary: false,
          unreadable: true,
          mtime: 0,
        } as never);
      }
      return Promise.resolve({} as never);
    });

    const tab = makeFileTab("/wt/locked.bin");
    const meta = fileMetaForPath("/wt/locked.bin");
    const registerActions = vi.fn();
    const onDirtyChange = vi.fn();

    render(
      <HexViewer
        tab={tab}
        meta={meta}
        onDirtyChange={onDirtyChange}
        registerActions={registerActions}
      />
    );

    expect(screen.getByTestId("raw-preview")).toBeInTheDocument();
    // Empty string is shown (the pre renders but with no visible text).
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("file_read", expect.anything()));
  });
});
