import { describe, expect, it, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/utils";
import { useWorkbench } from "@/state/store";
import { EditorTabs } from "./EditorTabs";

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
    useWorkbench.setState({ fileTabs: [], activeFileTabId: null, workspaces: [], systemTabs: [], terminalTabs: [] });
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
});
