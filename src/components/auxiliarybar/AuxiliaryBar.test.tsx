import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { AuxiliaryBar } from "./AuxiliaryBar";
import { useWorkbench } from "@/state/store";

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({
    ...initial,
    layout: { ...initial.layout, auxiliaryView: "files", panelVisible: true },
  });
});

describe("AuxiliaryBar", () => {
  it("renders tabs and switches view via store", async () => {
    renderWithProviders(<AuxiliaryBar />);
    expect(screen.getByTestId("auxiliary-bar")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("aux-tab-diff"));
    expect(useWorkbench.getState().layout.auxiliaryView).toBe("diff");
    await userEvent.click(screen.getByTestId("aux-tab-preview"));
    expect(useWorkbench.getState().layout.auxiliaryView).toBe("preview");
  });

  it("renders panel section when panelVisible is true", () => {
    renderWithProviders(<AuxiliaryBar />);
    expect(screen.getByTestId("aux-panel-section")).toBeInTheDocument();
    expect(screen.getByTestId("bottom-panel")).toBeInTheDocument();
  });

  it("collapses panel to tab strip when panelVisible is false", () => {
    useWorkbench.setState({
      ...useWorkbench.getState(),
      layout: { ...useWorkbench.getState().layout, panelVisible: false },
    });
    renderWithProviders(<AuxiliaryBar />);
    // Resizable panel section is gone but the collapsed tab strip remains
    expect(screen.queryByTestId("aux-panel-section")).not.toBeInTheDocument();
    expect(screen.getByTestId("bottom-panel")).toBeInTheDocument();
    expect(screen.getByTestId("panel-tabs")).toBeInTheDocument();
  });
});
