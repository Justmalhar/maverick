import { describe, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import AdvancedSettings from "./AdvancedSettings";

describe("AdvancedSettings", () => {
  it("edits all fields", async () => {
    renderWithProviders(<AdvancedSettings />);
    fireEvent.change(screen.getByTestId("advanced-largetext"), { target: { value: "9000" } });
    fireEvent.change(screen.getByTestId("advanced-lru"), { target: { value: "12" } });
    await userEvent.click(screen.getByTestId("advanced-caffeinate"));
    await userEvent.click(screen.getByTestId("advanced-telemetry"));
  });
});
