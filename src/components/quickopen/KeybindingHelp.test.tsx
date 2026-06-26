import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, cleanup, waitFor } from "@testing-library/react";
import { renderWithProviders, screen } from "@/test/utils";
import { KeybindingHelp } from "./KeybindingHelp";
import { useWorkbench } from "@/state/store";

const initial = useWorkbench.getState();

beforeEach(() => {
  cleanup();
  useWorkbench.setState({ ...initial, keybindingHelpOpen: false });
});

describe("KeybindingHelp", () => {
  it("is not rendered while closed", () => {
    renderWithProviders(<KeybindingHelp />);
    expect(screen.queryByTestId("keybinding-help")).toBeNull();
  });

  it("renders the shared keybinding table when open", () => {
    useWorkbench.setState({ ...initial, keybindingHelpOpen: true });
    renderWithProviders(<KeybindingHelp />);
    expect(screen.getByTestId("keybinding-help")).toBeInTheDocument();
    // Reuses the single-source-of-truth Settings table.
    expect(screen.getByTestId("keybindings-settings")).toBeInTheDocument();
    expect(screen.getByTestId("keybinding-global.commandPalette")).toBeInTheDocument();
  });

  it("Escape closes the overlay through the store setter", async () => {
    useWorkbench.setState({ ...initial, keybindingHelpOpen: true });
    renderWithProviders(<KeybindingHelp />);
    fireEvent.keyDown(screen.getByTestId("keybinding-help"), { key: "Escape" });
    await waitFor(() => expect(useWorkbench.getState().keybindingHelpOpen).toBe(false));
  });
});
