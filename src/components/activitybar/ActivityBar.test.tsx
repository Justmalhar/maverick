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
  it("toggles the primary sidebar when clicking the active view", async () => {
    renderWithProviders(<ActivityBar />);
    await userEvent.click(screen.getByTestId("activitybar-projects"));
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
