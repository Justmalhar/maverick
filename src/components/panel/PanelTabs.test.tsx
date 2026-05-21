import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { PanelTabs } from "./PanelTabs";
import { useWorkbench } from "@/state/store";

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({ ...initial, layout: { ...initial.layout, panelVisible: true } });
});

describe("PanelTabs", () => {
  it("invokes onChange when a tab is clicked", async () => {
    const onChange = vi.fn();
    renderWithProviders(<PanelTabs value="setup" onChange={onChange} />);
    await userEvent.click(screen.getByTestId("panel-tab-setup"));
    expect(onChange).toHaveBeenCalledWith("setup");
  });

  it("collapse button toggles panel in store", async () => {
    renderWithProviders(<PanelTabs value="setup" onChange={() => {}} />);
    await userEvent.click(screen.getByTestId("panel-collapse"));
    expect(useWorkbench.getState().layout.panelVisible).toBe(false);
  });
});
