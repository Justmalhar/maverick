import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { SettingsSelect } from "./SettingsSelect";

const OPTIONS = [
  { value: "stable", label: "Stable" },
  { value: "beta", label: "Beta" },
];

describe("SettingsSelect", () => {
  it("renders current value and emits onValueChange on selection", async () => {
    const onValueChange = vi.fn();
    renderWithProviders(
      <SettingsSelect
        label="Update channel"
        value="stable"
        onValueChange={onValueChange}
        options={OPTIONS}
      />,
    );
    expect(screen.getByRole("combobox", { name: /update channel/i })).toHaveTextContent("Stable");
    await userEvent.click(screen.getByRole("combobox", { name: /update channel/i }));
    await userEvent.click(await screen.findByRole("option", { name: "Beta" }));
    expect(onValueChange).toHaveBeenCalledWith("beta");
  });
});
