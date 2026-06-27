import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/utils";
import { useWorkbench } from "@/state/store";
import type { FileTab } from "@/state/store";
import { EditorTabs } from "./EditorTabs";
import { FileEditorTab } from "./FileEditorTab";

function openTab(path = "/wt/src/a.ts", overrides: Record<string, unknown> = {}) {
  useWorkbench.getState().openFileTab({
    kind: "file",
    path,
    worktreePath: "/wt",
    preview: true,
    ...(overrides as object),
  });
}

describe("file tabs in EditorTabs", () => {
  beforeEach(() => {
    useWorkbench.setState({ fileTabs: [], activeFileTabId: null, workspaces: [], systemTabs: [] });
  });

  it("renders the basename, italic while preview", () => {
    openTab();
    renderWithProviders(<EditorTabs />);
    const tab = screen.getByTestId("editor-tab-file-file:/wt/src/a.ts");
    expect(tab).toHaveTextContent("a.ts");
    expect(tab.querySelector(".italic")).not.toBeNull();
  });

  it("not italic once pinned", () => {
    openTab();
    useWorkbench.getState().pinFileTab("file:/wt/src/a.ts");
    renderWithProviders(<EditorTabs />);
    expect(
      screen.getByTestId("editor-tab-file-file:/wt/src/a.ts").querySelector(".italic")
    ).toBeNull();
  });

  it("double-click pins the preview tab", () => {
    openTab();
    renderWithProviders(<EditorTabs />);
    fireEvent.doubleClick(screen.getByTestId("editor-tab-file-file:/wt/src/a.ts"));
    expect(useWorkbench.getState().fileTabs[0].preview).toBe(false);
  });

  it("shows a dirty dot instead of the close icon when dirty", () => {
    openTab();
    useWorkbench.getState().setFileTabDirty("file:/wt/src/a.ts", true);
    renderWithProviders(<EditorTabs />);
    expect(screen.getByTestId("file-tab-dirty-file:/wt/src/a.ts")).toBeInTheDocument();
  });

  it("close button closes a clean tab", () => {
    openTab();
    renderWithProviders(<EditorTabs />);
    fireEvent.click(screen.getByRole("button", { name: "Close a.ts" }));
    expect(useWorkbench.getState().fileTabs).toHaveLength(0);
  });

  it("closing a dirty tab opens a confirm dialog; confirming force-closes", async () => {
    openTab();
    useWorkbench.getState().setFileTabDirty("file:/wt/src/a.ts", true);
    renderWithProviders(<EditorTabs />);
    fireEvent.click(screen.getByRole("button", { name: "Close a.ts" }));
    expect(useWorkbench.getState().fileTabs).toHaveLength(1);
    fireEvent.click(await screen.findByRole("button", { name: /close without saving/i }));
    expect(useWorkbench.getState().fileTabs).toHaveLength(0);
  });

  it("cancel in the unsaved-changes dialog keeps the tab open", async () => {
    openTab();
    useWorkbench.getState().setFileTabDirty("file:/wt/src/a.ts", true);
    renderWithProviders(<EditorTabs />);
    fireEvent.click(screen.getByRole("button", { name: "Close a.ts" }));
    // Dialog opens.
    expect(await screen.findByRole("button", { name: /cancel/i })).toBeInTheDocument();
    // Click the Cancel button inside the unsaved-changes dialog.
    const cancelButtons = screen.getAllByRole("button", { name: /cancel/i });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]);
    // Tab is still there.
    expect(useWorkbench.getState().fileTabs).toHaveLength(1);
  });

  it("pressing Escape on the unsaved-changes dialog closes it without losing the tab", async () => {
    openTab();
    useWorkbench.getState().setFileTabDirty("file:/wt/src/a.ts", true);
    renderWithProviders(<EditorTabs />);
    fireEvent.click(screen.getByRole("button", { name: "Close a.ts" }));
    // Dialog opens — confirm it's visible.
    expect(await screen.findByText("Unsaved changes")).toBeInTheDocument();
    // ESC triggers onOpenChange(false), which calls setConfirmCloseId(null).
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape", bubbles: true });
    // Tab is still there.
    expect(useWorkbench.getState().fileTabs).toHaveLength(1);
  });

  it("clicking a file tab sets it as the active file tab", () => {
    // Use preview: false so both tabs are kept simultaneously.
    openTab("/wt/src/a.ts", { preview: false });
    openTab("/wt/src/b.ts", { preview: false });
    renderWithProviders(<EditorTabs />);
    // Both tabs exist. Click b.ts tab to make it active.
    fireEvent.click(screen.getByTestId("editor-tab-file-file:/wt/src/b.ts"));
    expect(useWorkbench.getState().activeFileTabId).toBe("file:/wt/src/b.ts");
    // Click a.ts to switch back — exercises the onSelect arrow function.
    fireEvent.click(screen.getByTestId("editor-tab-file-file:/wt/src/a.ts"));
    expect(useWorkbench.getState().activeFileTabId).toBe("file:/wt/src/a.ts");
  });
});

describe("FileEditorTab (isolated)", () => {
  const tab: FileTab = {
    id: "file:/wt/src/a.ts",
    kind: "file",
    path: "/wt/src/a.ts",
    worktreePath: "/wt",
    workspaceId: null,
    preview: false,
    dirty: false,
    mode: "edit",
    viewed: false,
  };

  it("calls onSelect when clicked", () => {
    const onSelect = vi.fn();
    const onPin = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <FileEditorTab tab={tab} active={false} onSelect={onSelect} onPin={onPin} onClose={onClose} />
    );
    fireEvent.click(screen.getByTestId("editor-tab-file-file:/wt/src/a.ts"));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("calls onPin when double-clicked", () => {
    const onSelect = vi.fn();
    const onPin = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <FileEditorTab tab={tab} active={false} onSelect={onSelect} onPin={onPin} onClose={onClose} />
    );
    fireEvent.doubleClick(screen.getByTestId("editor-tab-file-file:/wt/src/a.ts"));
    expect(onPin).toHaveBeenCalledOnce();
  });

  it("calls onClose when close control is clicked", () => {
    const onSelect = vi.fn();
    const onPin = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <FileEditorTab tab={tab} active={true} onSelect={onSelect} onPin={onPin} onClose={onClose} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Close a.ts" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Enter is pressed on the close control", () => {
    const onSelect = vi.fn();
    const onPin = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <FileEditorTab tab={tab} active={true} onSelect={onSelect} onPin={onPin} onClose={onClose} />
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Close a.ts" }), { key: "Enter" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Enter is pressed on the dirty-dot close control", () => {
    const dirtyTab: FileTab = { ...tab, dirty: true };
    const onSelect = vi.fn();
    const onPin = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <FileEditorTab tab={dirtyTab} active={true} onSelect={onSelect} onPin={onPin} onClose={onClose} />
    );
    fireEvent.keyDown(screen.getByTestId("file-tab-dirty-file:/wt/src/a.ts"), { key: "Enter" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Space is pressed on the dirty-dot close control", () => {
    const dirtyTab: FileTab = { ...tab, dirty: true };
    const onSelect = vi.fn();
    const onPin = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <FileEditorTab tab={dirtyTab} active={true} onSelect={onSelect} onPin={onPin} onClose={onClose} />
    );
    fireEvent.keyDown(screen.getByTestId("file-tab-dirty-file:/wt/src/a.ts"), { key: " " });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when dirty-dot is clicked", () => {
    const dirtyTab: FileTab = { ...tab, dirty: true };
    const onSelect = vi.fn();
    const onPin = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <FileEditorTab tab={dirtyTab} active={true} onSelect={onSelect} onPin={onPin} onClose={onClose} />
    );
    fireEvent.click(screen.getByTestId("file-tab-dirty-file:/wt/src/a.ts"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders a file-type icon for a file tab and the compare glyph for a diff tab", () => {
    const noop = vi.fn();
    const { rerender, container } = renderWithProviders(
      <FileEditorTab tab={tab} active={false} onSelect={noop} onPin={noop} onClose={noop} />
    );
    // File tabs use the Material file-type icon (an <img>).
    expect(container.querySelector("img")?.getAttribute("src")).toContain("typescript.svg");

    const diffTab: FileTab = { ...tab, id: "diff:/wt/src/a.ts", kind: "diff", mode: "diff" };
    rerender(
      <FileEditorTab tab={diffTab} active={false} onSelect={noop} onPin={noop} onClose={noop} />
    );
    // Diff tabs keep the lucide compare glyph (an <svg>), not a file-type icon.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
