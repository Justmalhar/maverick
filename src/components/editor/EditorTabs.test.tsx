import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { EditorTabs } from "./EditorTabs";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({
    ...initial, workspaces: [], activeWorkspaceId: null, commandPaletteOpen: false,
    editorModes: {},
  });
});

describe("EditorTabs", () => {
  it("renders new-workspace + tabs and reacts to clicks", async () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" }), makeWorkspace({ id: "w2" })],
      activeWorkspaceId: "w1",
    });
    renderWithProviders(<EditorTabs />);
    expect(screen.getByTestId("editor-tab-w1")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("editor-tab-w2"));
    expect(useWorkbench.getState().activeWorkspaceId).toBe("w2");
    await userEvent.click(screen.getByLabelText("Close workspace", { selector: "[data-testid=editor-tab-w2] button" }).closest("button")!);
  });

  it("plus button renders the open-view dropdown", async () => {
    renderWithProviders(<EditorTabs />);
    await userEvent.click(screen.getByTestId("editor-tabs-new"));
    // The dropdown should render at least the Browser item
    expect(screen.getByTestId("editor-tabs-open-browser")).toBeInTheDocument();
  });
});
