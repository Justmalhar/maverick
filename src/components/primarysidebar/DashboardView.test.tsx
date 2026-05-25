import { describe, it, expect, beforeEach } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import { DashboardView } from "./DashboardView";
import { useWorkbench } from "@/state/store";
import { makeWorkspace } from "@/test/fixtures";

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({ ...initial, workspaces: [] });
});

describe("DashboardView", () => {
  it("renders dashboard with session cost and workspace count", () => {
    renderWithProviders(<DashboardView />);
    expect(screen.getByTestId("dashboard-view")).toBeInTheDocument();
    expect(screen.getByText("Session cost")).toBeInTheDocument();
    expect(screen.getByText("Workspaces")).toBeInTheDocument();
    expect(screen.getByText("$0.00")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("reflects workspace count in stat card", () => {
    useWorkbench.setState({
      ...initial,
      workspaces: [makeWorkspace({ id: "w1" }), makeWorkspace({ id: "w2" })],
    });
    renderWithProviders(<DashboardView />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
