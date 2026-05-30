import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { invoke } from "@tauri-apps/api/core";
import { vi } from "vitest";
import { PrimarySideBar } from "./PrimarySideBar";
import { useWorkbench } from "@/state/store";

const initial = useWorkbench.getState();

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue([] as never);
  useWorkbench.setState({
    ...initial,
    systemTabs: [],
    activeSystemTab: null,
    layout: { ...initial.layout, activityView: "projects" },
  });
});

describe("PrimarySideBar", () => {
  it("renders all nav items in projects view", () => {
    renderWithProviders(<PrimarySideBar />);
    expect(screen.getByTestId("sidebar-nav-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-kanban")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-automations")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-mcps")).toBeInTheDocument();
  });

  it("always renders the projects list in projects view", () => {
    renderWithProviders(<PrimarySideBar />);
    expect(screen.getByTestId("projects-view")).toBeInTheDocument();
  });

  it("clicking a nav item opens its system tab in the editor", async () => {
    renderWithProviders(<PrimarySideBar />);
    await userEvent.click(screen.getByTestId("sidebar-nav-dashboard"));
    expect(useWorkbench.getState().activeSystemTab).toBe("dashboard");
  });

  it("clicking an already-open tab activates it without duplicating", async () => {
    useWorkbench.setState({ ...initial, systemTabs: ["kanban"], activeSystemTab: null });
    renderWithProviders(<PrimarySideBar />);
    await userEvent.click(screen.getByTestId("sidebar-nav-kanban"));
    expect(useWorkbench.getState().systemTabs).toHaveLength(1);
    expect(useWorkbench.getState().activeSystemTab).toBe("kanban");
  });

  it("nav item shows active state when its tab is the active system tab", () => {
    useWorkbench.setState({ ...initial, systemTabs: ["dashboard"], activeSystemTab: "dashboard" });
    renderWithProviders(<PrimarySideBar />);
    const btn = screen.getByTestId("sidebar-nav-dashboard");
    expect(btn.className).toMatch(/bg-sidebar-selected/);
  });

  it("renders GitPanel (lazy) when activityView is git", async () => {
    useWorkbench.setState({
      ...initial,
      layout: { ...initial.layout, activityView: "git" },
    });
    renderWithProviders(<PrimarySideBar />);
    // GitPanel renders a git-panel testid after Suspense resolves
    await waitFor(() => expect(screen.getByTestId("primary-sidebar")).toBeInTheDocument());
    // The nav items should NOT be present in git view
    expect(screen.queryByTestId("sidebar-nav-dashboard")).not.toBeInTheDocument();
    expect(screen.queryByTestId("projects-view")).not.toBeInTheDocument();
  });
});
