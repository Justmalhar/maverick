import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { SettingsToggle } from "./SettingsToggle";

describe("SettingsToggle", () => {
  it("fires onCheckedChange when clicked", async () => {
    const onCheckedChange = vi.fn();
    renderWithProviders(
      <SettingsToggle
        label="GPG signing"
        checked={false}
        onCheckedChange={onCheckedChange}
      />,
    );
    await userEvent.click(screen.getByRole("switch", { name: /gpg signing/i }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("does not fire when disabled", async () => {
    const onCheckedChange = vi.fn();
    renderWithProviders(
      <SettingsToggle
        label="Telemetry"
        checked={true}
        onCheckedChange={onCheckedChange}
        disabled
      />,
    );
    await userEvent.click(screen.getByRole("switch", { name: /telemetry/i }));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
