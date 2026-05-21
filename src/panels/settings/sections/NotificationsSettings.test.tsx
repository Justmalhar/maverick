import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import NotificationsSettings from "./NotificationsSettings";
import { _resetSettingsStoreForTests } from "@/lib/stores/settings";

describe("NotificationsSettings", () => {
  beforeEach(() => _resetSettingsStoreForTests());

  it("renders all notification toggles and flips one", async () => {
    renderWithProviders(<NotificationsSettings />);
    const toggle = screen.getByRole("switch", { name: /agent waiting for input/i });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(toggle).not.toBeChecked();
  });
});
