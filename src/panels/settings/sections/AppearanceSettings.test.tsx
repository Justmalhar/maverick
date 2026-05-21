import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import AppearanceSettings from "./AppearanceSettings";
import { _resetSettingsStoreForTests } from "@/lib/stores/settings";

describe("AppearanceSettings", () => {
  beforeEach(() => _resetSettingsStoreForTests());

  it("adjusts font sizes, toggles ligatures and animations, edits a custom color", async () => {
    renderWithProviders(<AppearanceSettings />);

    fireEvent.change(screen.getByTestId("ui-font-size"), { target: { value: "14" } });
    expect(screen.getByText(/UI font size \(14px\)/i)).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("terminal-font-size"), { target: { value: "15" } });
    expect(screen.getByText(/Terminal font size \(15px\)/i)).toBeInTheDocument();

    const ligatures = screen.getByRole("switch", { name: /ligatures/i });
    expect(ligatures).toBeChecked();
    await userEvent.click(ligatures);
    expect(ligatures).not.toBeChecked();

    const animations = screen.getByRole("switch", { name: /animations/i });
    await userEvent.click(animations);
    expect(animations).not.toBeChecked();

    const accentPicker = screen.getByTestId("color-appearance.customColors.accent");
    fireEvent.change(accentPicker, { target: { value: "#7c3aed" } });
    expect(accentPicker).toHaveValue("#7c3aed");
  });
});
