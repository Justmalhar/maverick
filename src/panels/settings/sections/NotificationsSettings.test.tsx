import { describe, it, expect, beforeEach, vi } from "vitest";
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

  it("Request notification permission button calls the Tauri command", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
    mockInvoke.mockResolvedValueOnce("granted");
    const { render, screen: localScreen } = await import("@testing-library/react");
    const NotificationsSettingsComp = (await import("./NotificationsSettings")).default;
    render(<NotificationsSettingsComp />);
    await userEvent.click(localScreen.getByRole("button", { name: /request notification permission/i }));
    expect(mockInvoke).toHaveBeenCalledWith("request_notification_permission");
  });
});
