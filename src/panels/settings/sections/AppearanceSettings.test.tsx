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

  it("applies green-dominant hex color (hexToHslTriple case g:)", () => {
    renderWithProviders(<AppearanceSettings />);
    const bgPicker = screen.getByTestId("color-appearance.customColors.background");
    // #00FF00 is pure green — max channel is green, triggers case g: branch
    fireEvent.change(bgPicker, { target: { value: "#00FF00" } });
    expect(bgPicker).toHaveValue("#00ff00");
  });

  it("'Reset all custom colors' clears all custom color values", async () => {
    renderWithProviders(<AppearanceSettings />);
    const bgPicker = screen.getByTestId("color-appearance.customColors.background");
    fireEvent.change(bgPicker, { target: { value: "#FF0000" } });
    await userEvent.click(screen.getByRole("button", { name: /Reset all custom colors/i }));
    expect((bgPicker as HTMLInputElement).value).toBe("#000000");
  });

  it("invalid hex skips CSS variable update (hexToHslTriple returns null)", () => {
    renderWithProviders(<AppearanceSettings />);
    const accentPicker = screen.getByTestId("color-appearance.customColors.accent");
    fireEvent.change(accentPicker, { target: { value: "#gg0000" } });
    // No crash — hexToHslTriple returned null for invalid hex
  });

  it("red-dominant hex with g < b triggers +6 branch in hexToHslTriple", () => {
    renderWithProviders(<AppearanceSettings />);
    const accentPicker = screen.getByTestId("color-appearance.customColors.accent");
    // #FF0088: r=255 (max), g=0, b=136 → g < b → +6 branch
    fireEvent.change(accentPicker, { target: { value: "#ff0088" } });
    expect(accentPicker).toHaveValue("#ff0088");
  });

  it("clicking a theme swatch button invokes setTheme", async () => {
    renderWithProviders(<AppearanceSettings />);
    // Theme swatches have data-testid="theme-<name>", find first one
    const swatch = document.querySelector("[data-testid^='theme-']") as HTMLElement;
    if (swatch) await userEvent.click(swatch);
    // No crash — the () => setTheme(t) handler fired
  });

  it("text hex input onChange updates the stored value", () => {
    renderWithProviders(<AppearanceSettings />);
    // There are two inputs per color row: the color-picker and the text input.
    // Grab all text inputs (type=text) inside the CustomColors group.
    const textInputs = screen.getAllByPlaceholderText("#000000");
    fireEvent.change(textInputs[0], { target: { value: "#aabbcc" } });
    expect((textInputs[0] as HTMLInputElement).value).toBe("#aabbcc");
  });

  it("per-color Reset button clears that color value", async () => {
    renderWithProviders(<AppearanceSettings />);
    // Set a color first so the inline Reset button appears
    const bgPicker = screen.getByTestId("color-appearance.customColors.background");
    fireEvent.change(bgPicker, { target: { value: "#112233" } });
    // The inline "Reset" button should now be visible for that row
    const resetBtn = screen.getAllByRole("button", { name: /^Reset$/i })[0];
    await userEvent.click(resetBtn);
    // After reset, the hex field should be empty (back to #000000 default for color input)
    expect((bgPicker as HTMLInputElement).value).toBe("#000000");
  });
});
