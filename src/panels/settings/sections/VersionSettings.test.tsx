import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { _resetSettingsStoreForTests } from "@/lib/stores/settings";
import VersionSettings from "./VersionSettings";

describe("VersionSettings", () => {
  beforeEach(() => _resetSettingsStoreForTests());

  it("renders version string and update channel select", () => {
    renderWithProviders(<VersionSettings />);
    expect(screen.getByTestId("version-settings")).toBeInTheDocument();
    expect(screen.getByTestId("version-string")).toBeInTheDocument();
    expect(screen.getByTestId("version-channel")).toBeInTheDocument();
    expect(screen.getByTestId("version-check")).toBeInTheDocument();
  });

  it("Copy version button writes to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderWithProviders(<VersionSettings />);
    await userEvent.click(screen.getByLabelText("Copy version"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("0.1.0"));
  });

  it("Copy version silently fails when clipboard is blocked", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("blocked")) },
      configurable: true,
    });
    renderWithProviders(<VersionSettings />);
    await userEvent.click(screen.getByLabelText("Copy version"));
    // No crash expected
  });
});
