import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import AdvancedSettings from "./AdvancedSettings";
import { _resetSettingsStoreForTests } from "@/lib/stores/settings";

describe("AdvancedSettings", () => {
  beforeEach(() => _resetSettingsStoreForTests());

  it("edits numeric fields and toggles caffeinate + telemetry", async () => {
    renderWithProviders(<AdvancedSettings />);
    fireEvent.change(screen.getByTestId("advanced-largetext"), { target: { value: "10000" } });
    expect(screen.getByTestId("advanced-largetext")).toHaveValue(10000);

    fireEvent.change(screen.getByTestId("advanced-lru"), { target: { value: "12" } });
    expect(screen.getByTestId("advanced-lru")).toHaveValue(12);

    const caf = screen.getByRole("switch", { name: /caffeinate/i });
    expect(caf).toBeChecked();
    await userEvent.click(caf);
    expect(caf).not.toBeChecked();

    const tel = screen.getByRole("switch", { name: /telemetry/i });
    expect(tel).not.toBeChecked();
    await userEvent.click(tel);
    expect(tel).toBeChecked();
  });
});
