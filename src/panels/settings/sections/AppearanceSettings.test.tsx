import { describe, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import AppearanceSettings from "./AppearanceSettings";

describe("AppearanceSettings", () => {
  it("switches theme and toggles options", async () => {
    renderWithProviders(<AppearanceSettings />);
    await userEvent.click(screen.getByTestId("theme-nord"));
    fireEvent.change(screen.getByTestId("ui-font-size"), { target: { value: "14" } });
    fireEvent.change(screen.getByTestId("terminal-font-size"), { target: { value: "16" } });
    await userEvent.click(screen.getByTestId("ligatures-toggle"));
    await userEvent.click(screen.getByTestId("animations-toggle"));
  });
});
