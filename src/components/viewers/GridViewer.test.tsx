import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkbench } from "@/state/store";
import { fileMetaForPath } from "@/lib/viewers/types";
import GridViewer from "./GridViewer";

const invokeMock = vi.mocked(invoke);

function tabFor(path: string) {
  useWorkbench.setState({ fileTabs: [], activeFileTabId: null });
  useWorkbench.getState().openFileTab({ kind: "file", path, worktreePath: "/wt", preview: false });
  return useWorkbench.getState().fileTabs[0];
}

const csvResult = { content: "name,qty\nbanana,5\napple,3", size: 24, binary: false, unreadable: false, mtime: 1 };

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(csvResult);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GridViewer", () => {
  it("renders header and data rows from CSV", async () => {
    const tab = tabFor("/wt/data.csv");
    render(
      <GridViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={vi.fn()} />
    );
    expect(await screen.findByRole("columnheader", { name: /name/i })).toBeInTheDocument();
    expect(screen.getByText("banana")).toBeInTheDocument();
    expect(screen.getByText("apple")).toBeInTheDocument();
  });

  it("clicking a header sorts the column asc", async () => {
    const tab = tabFor("/wt/data.csv");
    render(
      <GridViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={vi.fn()} />
    );
    fireEvent.click(await screen.findByRole("columnheader", { name: /name/i }));
    const cells = screen.getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("apple");
  });

  it("clicking a header twice toggles to descending sort", async () => {
    const tab = tabFor("/wt/data.csv");
    render(
      <GridViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={vi.fn()} />
    );
    const header = await screen.findByRole("columnheader", { name: /name/i });
    fireEvent.click(header); // asc
    fireEvent.click(header); // desc
    const cells = screen.getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("banana");
  });

  it("sorts numerically when all values in column are numeric", async () => {
    invokeMock.mockResolvedValue({ content: "name,qty\nbanana,5\napple,3\ncherry,10", size: 30, binary: false, unreadable: false, mtime: 1 });
    const tab = tabFor("/wt/data.csv");
    render(
      <GridViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={vi.fn()} />
    );
    // Sort by qty (col 1) asc — numeric: 3, 5, 10
    fireEvent.click(await screen.findByRole("columnheader", { name: /qty/i }));
    const cells = screen.getAllByRole("cell");
    // First row: apple (qty=3) -> cells[0]=apple, cells[1]=3
    expect(cells[0]).toHaveTextContent("apple");
    expect(cells[1]).toHaveTextContent("3");
  });

  it("parses TSV when ext is tsv", async () => {
    invokeMock.mockResolvedValue({ content: "name\tqty\nfoo\t1", size: 14, binary: false, unreadable: false, mtime: 1 });
    const tab = tabFor("/wt/data.tsv");
    render(
      <GridViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={vi.fn()} />
    );
    expect(await screen.findByRole("columnheader", { name: /name/i })).toBeInTheDocument();
    expect(screen.getByText("foo")).toBeInTheDocument();
  });

  it("xlsx files go through the SheetJS path", async () => {
    // Stub global.fetch to return an ArrayBuffer so loadXlsx can run
    const ab = new ArrayBuffer(8);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      arrayBuffer: async () => ab,
    }));
    invokeMock.mockResolvedValue({ content: "", size: 100, binary: true, unreadable: false, mtime: 1 });
    const tab = tabFor("/wt/book.xlsx");
    render(
      <GridViewer tab={tab} meta={fileMetaForPath(tab.path, { binary: true })} onDirtyChange={vi.fn()} registerActions={vi.fn()} />
    );
    // The xlsx mock returns [["name","qty"],["apple",3]] via sheet_to_json
    expect(await screen.findByRole("columnheader", { name: /name/i })).toBeInTheDocument();
    expect(screen.getByText("apple")).toBeInTheDocument();
  });

  it("copyContents action writes tab-separated text to clipboard", async () => {
    const tab = tabFor("/wt/data.csv");
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    let actions: { copyContents?: () => Promise<void> } = {};
    render(
      <GridViewer
        tab={tab}
        meta={fileMetaForPath(tab.path)}
        onDirtyChange={vi.fn()}
        registerActions={(a) => { actions = a; }}
      />
    );
    await screen.findByRole("columnheader", { name: /name/i });
    await actions.copyContents?.();
    expect(writeText).toHaveBeenCalledWith("name\tqty\nbanana\t5\napple\t3");
  });

  it("renders all rows without virtualization when count <= 50", async () => {
    // 2 data rows — below threshold, plain map is used
    invokeMock.mockResolvedValue({ content: "x\n1\n2", size: 6, binary: false, unreadable: false, mtime: 1 });
    const tab = tabFor("/wt/data.csv");
    render(
      <GridViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={vi.fn()} />
    );
    expect(await screen.findByRole("columnheader", { name: /x/i })).toBeInTheDocument();
    const cells = screen.getAllByRole("cell");
    expect(cells).toHaveLength(2);
  });

  it("uses FixedSizeList when rows exceed threshold (> 50)", async () => {
    // Generate 60 data rows
    const dataRows = Array.from({ length: 60 }, (_, i) => `val${i}`).join("\n");
    const content = `name\n${dataRows}`;
    invokeMock.mockResolvedValue({ content, size: content.length, binary: false, unreadable: false, mtime: 1 });
    const tab = tabFor("/wt/data.csv");
    render(
      <GridViewer tab={tab} meta={fileMetaForPath(tab.path)} onDirtyChange={vi.fn()} registerActions={vi.fn()} />
    );
    // The react-window mock renders a wrapper div with data-testid="fixed-size-list"
    expect(await screen.findByTestId("fixed-size-list")).toBeInTheDocument();
  });
});
