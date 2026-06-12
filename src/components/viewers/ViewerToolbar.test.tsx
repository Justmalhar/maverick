import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { useWorkbench } from "@/state/store";
import { ViewerToolbar } from "./ViewerToolbar";
import type { ViewerActions } from "@/lib/viewers/types";

function setup(tabOverrides: Record<string, unknown> = {}, actions: ViewerActions = {}) {
  useWorkbench.setState({ fileTabs: [], activeFileTabId: null });
  useWorkbench.getState().openFileTab({
    kind: "diff",
    path: "/wt/src/components/A.tsx",
    worktreePath: "/wt",
    preview: false,
    ...(tabOverrides as object),
  });
  const tab = useWorkbench.getState().fileTabs[0];
  const candidates = [
    { id: "diff", displayName: "Diff", priority: 5, capabilities: { diff: true }, canHandle: () => true, load: async () => () => null },
    { id: "hex", displayName: "Hex", priority: 0, capabilities: {}, canHandle: () => true, load: async () => () => null },
  ];
  renderWithProviders(<ViewerToolbar tab={tab} actions={actions} candidates={candidates as never} />);
  return tab;
}

describe("ViewerToolbar", () => {
  beforeEach(() => {
    useWorkbench.setState({ fileTabs: [], activeFileTabId: null });
  });

  it("renders the breadcrumb path relative to the worktree", () => {
    setup();
    expect(screen.getByText("src")).toBeInTheDocument();
    expect(screen.getByText("components")).toBeInTheDocument();
    expect(screen.getByText("A.tsx")).toBeInTheDocument();
  });

  it("Diff/Edit switcher sets tab mode", () => {
    const tab = setup();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(useWorkbench.getState().fileTabs[0].mode).toBe("edit");
    fireEvent.click(screen.getByRole("button", { name: "Diff" }));
    expect(useWorkbench.getState().fileTabs[0].mode).toBe("diff");
    void tab;
  });

  it("copy button calls the registered action", () => {
    const copyContents = vi.fn(async () => {});
    setup({}, { copyContents });
    fireEvent.click(screen.getByRole("button", { name: /copy contents/i }));
    expect(copyContents).toHaveBeenCalled();
  });

  it("undo changes asks for confirmation then calls discardChanges", async () => {
    const discardChanges = vi.fn(async () => {});
    setup({}, { discardChanges });
    fireEvent.click(screen.getByRole("button", { name: /undo changes/i }));
    expect(discardChanges).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /discard/i }));
    expect(discardChanges).toHaveBeenCalled();
  });

  it("viewed checkbox toggles tab.viewed on diff tabs", () => {
    setup();
    fireEvent.click(screen.getByRole("checkbox", { name: /viewed/i }));
    expect(useWorkbench.getState().fileTabs[0].viewed).toBe(true);
  });

  it("save button appears when dirty and calls the save action", () => {
    const save = vi.fn(async () => {});
    setup({}, { save });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    act(() => {
      useWorkbench.getState().setFileTabDirty(useWorkbench.getState().fileTabs[0].id, true);
    });
    const btn = screen.getByRole("button", { name: "Save" });
    fireEvent.click(btn);
    expect(save).toHaveBeenCalled();
  });

  it("Open With menu lists candidates and sets viewerId", async () => {
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /open with/i }));
    await user.click(screen.getByText("Hex"));
    expect(useWorkbench.getState().fileTabs[0].viewerId).toBe("hex");
  });

  it("cancel button in discard dialog closes without discarding", async () => {
    const discardChanges = vi.fn(async () => {});
    setup({}, { discardChanges });
    fireEvent.click(screen.getByRole("button", { name: /undo changes/i }));
    // Click Cancel instead of Discard.
    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));
    expect(discardChanges).not.toHaveBeenCalled();
  });

  it("falls back to raw path when path does not start with worktreePath", () => {
    // Render a tab whose path is not under worktreePath — hits the `else`
    // branch of relSegments (line 30 of ViewerToolbar.tsx).
    useWorkbench.setState({ fileTabs: [], activeFileTabId: null });
    useWorkbench.getState().openFileTab({
      kind: "file",
      path: "/other/place/file.ts",
      worktreePath: "/wt",
      preview: false,
    });
    const tab = useWorkbench.getState().fileTabs[0];
    const candidates = [
      { id: "hex", displayName: "Hex", priority: 0, capabilities: {}, canHandle: () => true, load: async () => () => null },
    ];
    renderWithProviders(
      <ViewerToolbar tab={tab} actions={{}} candidates={candidates as never} />
    );
    // The raw path is split by "/" and rendered as breadcrumb segments.
    expect(screen.getByText("file.ts")).toBeInTheDocument();
  });
});
