import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { ActivityBar } from "./ActivityBar";
import { useWorkbench } from "@/state/store";

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({
    ...initial,
    layout: { ...initial.layout, activityView: "projects", primarySideBarVisible: true },
    systemTabs: [],
    activeSystemTab: null,
  });
});

describe("ActivityBar", () => {
  it("calls setActivityView when sidebar is hidden (makes it visible again)", async () => {
    useWorkbench.setState({
      ...useWorkbench.getState(),
      layout: { ...useWorkbench.getState().layout, activityView: "projects", primarySideBarVisible: false },
    });
    renderWithProviders(<ActivityBar />);
    await userEvent.click(screen.getByTestId("activitybar-projects"));
    // setActivityView always opens the sidebar — so it becomes true
    expect(useWorkbench.getState().layout.primarySideBarVisible).toBe(true);
    expect(useWorkbench.getState().layout.activityView).toBe("projects");
  });

  it("toggles the primary sidebar when clicking the active view", async () => {
    renderWithProviders(<ActivityBar />);
    await userEvent.click(screen.getByTestId("activitybar-projects"));
    expect(useWorkbench.getState().layout.primarySideBarVisible).toBe(false);
  });

  it("renders the git view item", () => {
    renderWithProviders(<ActivityBar />);
    expect(screen.getByTestId("activitybar-git")).toBeInTheDocument();
  });

  it("sets activityView to git when the git item is clicked", async () => {
    renderWithProviders(<ActivityBar />);
    await userEvent.click(screen.getByTestId("activitybar-git"));
    expect(useWorkbench.getState().layout.activityView).toBe("git");
    expect(useWorkbench.getState().layout.primarySideBarVisible).toBe(true);
  });

  it("toggles sidebar when git view is already active and sidebar is visible", async () => {
    useWorkbench.setState({
      ...useWorkbench.getState(),
      layout: { ...useWorkbench.getState().layout, activityView: "git", primarySideBarVisible: true },
    });
    renderWithProviders(<ActivityBar />);
    await userEvent.click(screen.getByTestId("activitybar-git"));
    expect(useWorkbench.getState().layout.primarySideBarVisible).toBe(false);
  });

  it("opens a system tab when clicking a tab item", async () => {
    renderWithProviders(<ActivityBar />);
    await userEvent.click(screen.getByTestId("activitybar-tab-kanban"));
    expect(useWorkbench.getState().activeSystemTab).toBe("kanban");
  });

  it("switches to an already-open system tab without duplicating it", async () => {
    useWorkbench.setState({ ...useWorkbench.getState(), systemTabs: ["kanban"], activeSystemTab: null });
    renderWithProviders(<ActivityBar />);
    await userEvent.click(screen.getByTestId("activitybar-tab-kanban"));
    expect(useWorkbench.getState().systemTabs).toHaveLength(1);
    expect(useWorkbench.getState().activeSystemTab).toBe("kanban");
  });
});
