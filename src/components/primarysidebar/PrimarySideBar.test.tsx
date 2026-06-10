import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
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
  });
});

describe("PrimarySideBar", () => {
  it("renders all nav items including Skills", () => {
    renderWithProviders(<PrimarySideBar />);
    expect(screen.getByTestId("sidebar-nav-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-kanban")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-automations")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-mcps")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-skills")).toBeInTheDocument();
  });

  it("does not render Projects or Source Control nav buttons", () => {
    renderWithProviders(<PrimarySideBar />);
    expect(screen.queryByTestId("sidebar-nav-projects")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-nav-git")).not.toBeInTheDocument();
  });

  it("always renders the projects list", () => {
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
});
