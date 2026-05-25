import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent } from "@testing-library/react";
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

  it("inactive system tab click activates it", async () => {
    useWorkbench.setState({
      ...initial,
      systemTabs: ["browser", "kanban"],
      activeSystemTab: "browser",
      activeWorkspaceId: null,
    });
    renderWithProviders(<EditorTabs />);
    await userEvent.click(screen.getByTestId("editor-tab-system-kanban"));
    expect(useWorkbench.getState().activeSystemTab).toBe("kanban");
  });

  it("close button on system tab removes it from systemTabs", async () => {
    useWorkbench.setState({
      ...initial,
      systemTabs: ["browser"],
      activeSystemTab: "browser",
      activeWorkspaceId: null,
    });
    renderWithProviders(<EditorTabs />);
    const closeBtn = screen.getByLabelText("Close Browser");
    await userEvent.click(closeBtn);
    expect(useWorkbench.getState().systemTabs).not.toContain("browser");
  });

  it("keyboard Enter on close button removes system tab", () => {
    useWorkbench.setState({
      ...initial,
      systemTabs: ["kanban"],
      activeSystemTab: "kanban",
      activeWorkspaceId: null,
    });
    renderWithProviders(<EditorTabs />);
    const closeBtn = screen.getByLabelText("Close Tasks");
    fireEvent.keyDown(closeBtn, { key: "Enter" });
    expect(useWorkbench.getState().systemTabs).not.toContain("kanban");
  });

  it("keyboard Space on close button removes system tab", () => {
    useWorkbench.setState({
      ...initial,
      systemTabs: ["automations"],
      activeSystemTab: "automations",
      activeWorkspaceId: null,
    });
    renderWithProviders(<EditorTabs />);
    const closeBtn = screen.getByLabelText("Close Automations");
    fireEvent.keyDown(closeBtn, { key: " " });
    expect(useWorkbench.getState().systemTabs).not.toContain("automations");
  });

  it("dropdown item click opens a system tab", async () => {
    renderWithProviders(<EditorTabs />);
    await userEvent.click(screen.getByTestId("editor-tabs-new"));
    await userEvent.click(screen.getByTestId("editor-tabs-open-browser"));
    expect(useWorkbench.getState().systemTabs).toContain("browser");
  });

  it("All commands dropdown item opens command palette", async () => {
    renderWithProviders(<EditorTabs />);
    await userEvent.click(screen.getByTestId("editor-tabs-new"));
    await userEvent.click(screen.getByText(/All commands/i));
    expect(useWorkbench.getState().commandPaletteOpen).toBe(true);
  });
});
