import { describe, it, expect } from "vitest";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import KeybindingsSettings from "./KeybindingsSettings";

describe("KeybindingsSettings", () => {
  it("renders categories and filters via search", () => {
    renderWithProviders(<KeybindingsSettings />);
    expect(screen.getByTestId("keybindings-settings")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("keybindings-search"), { target: { value: "git" } });
    expect(screen.getByTestId("keybinding-view.git")).toBeInTheDocument();
  });
});
