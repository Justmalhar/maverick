import { describe, it, expect, beforeEach } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import { StatusBar } from "./StatusBar";
import { useWorkbench } from "@/state/store";
import { makeBackend, makeWorkspace } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({ ...initial, workspaces: [], backends: [], activeWorkspaceId: null });
});

describe("StatusBar", () => {
  it("renders no backends placeholder + workspace count", () => {
    renderWithProviders(<StatusBar />);
    expect(screen.getByTestId("statusbar-backends")).toHaveTextContent("no backends");
    expect(screen.getByTestId("statusbar-workspaces")).toHaveTextContent("0 ws");
  });

  it("shows N backends when multiple are configured but none active", () => {
    useWorkbench.setState({
      ...initial,
      backends: [makeBackend({ id: "claude", active: false }), makeBackend({ id: "codex", active: false })],
      workspaces: [],
      activeWorkspaceId: null,
    });
    renderWithProviders(<StatusBar />);
    expect(screen.getByTestId("statusbar-backends")).toHaveTextContent("2 backends");
  });

  it("renders active backend chip(s) and branch when active workspace exists", () => {
    useWorkbench.setState({
      ...initial,
      backends: [makeBackend({ id: "claude", name: "claude", active: true }), makeBackend({ id: "codex", name: "codex", active: false })],
      workspaces: [makeWorkspace({ id: "w1", branch: "feat" })],
      activeWorkspaceId: "w1",
    });
    renderWithProviders(<StatusBar />);
    expect(screen.getByTestId("statusbar-backends")).toHaveTextContent("claude");
    expect(screen.getByTestId("statusbar-branch")).toHaveTextContent("feat");
    expect(screen.getByTestId("statusbar-workspaces")).toHaveTextContent("1 ws");
  });
});
