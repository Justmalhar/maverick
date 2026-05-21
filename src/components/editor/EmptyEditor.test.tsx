import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { EmptyEditor } from "./EmptyEditor";
import { useWorkbench } from "@/state/store";

const initial = useWorkbench.getState();

beforeEach(() => {
  useWorkbench.setState({
    ...initial, commandPaletteOpen: false, presetLauncherOpen: false,
    layout: { ...initial.layout, activityView: "git" },
  });
});

describe("EmptyEditor", () => {
  it("renders welcome, three CTAs and kbd hints", () => {
    renderWithProviders(<EmptyEditor />);
    expect(screen.getByTestId("empty-editor")).toBeInTheDocument();
    expect(screen.getByText("Welcome to Maverick")).toBeInTheDocument();
  });

  it("clicking Add project sets the projects view", async () => {
    renderWithProviders(<EmptyEditor />);
    await userEvent.click(screen.getByTestId("empty-add-project"));
    expect(useWorkbench.getState().layout.activityView).toBe("projects");
  });

  it("clicking Open preset opens the preset launcher", async () => {
    renderWithProviders(<EmptyEditor />);
    await userEvent.click(screen.getByTestId("empty-presets"));
    expect(useWorkbench.getState().presetLauncherOpen).toBe(true);
  });

  it("clicking Commands opens the command palette", async () => {
    renderWithProviders(<EmptyEditor />);
    await userEvent.click(screen.getByTestId("empty-commands"));
    expect(useWorkbench.getState().commandPaletteOpen).toBe(true);
  });
});
