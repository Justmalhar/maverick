import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { _resetSettingsStoreForTests } from "@/lib/stores/settings";
import VersionSettings from "./VersionSettings";

const mockCheck = vi.mocked(check);
const mockRelaunch = vi.mocked(relaunch);

function fakeUpdate(version: string): Update {
  return {
    version,
    currentVersion: "0.0.0",
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
  } as unknown as Update;
}

describe("VersionSettings", () => {
  beforeEach(() => {
    _resetSettingsStoreForTests();
    mockCheck.mockReset();
    mockCheck.mockResolvedValue(null);
    mockRelaunch.mockReset();
    mockRelaunch.mockResolvedValue(undefined);
  });

  it("renders version string and update channel select", () => {
    renderWithProviders(<VersionSettings />);
    expect(screen.getByTestId("version-settings")).toBeInTheDocument();
    expect(screen.getByTestId("version-string")).toBeInTheDocument();
    expect(screen.getByTestId("version-channel")).toBeInTheDocument();
    expect(screen.getByTestId("version-check")).toBeInTheDocument();
  });

  it("renders the build-time version (sentinel under test) not a hardcoded string", () => {
    renderWithProviders(<VersionSettings />);
    // The Vite define is not applied under vitest, so build-info falls back to
    // the 0.0.0/dev sentinels — proving the value is no longer a literal.
    expect(screen.getByTestId("version-string")).toHaveTextContent("0.0.0");
    expect(screen.getByTestId("version-string")).toHaveTextContent("dev");
  });

  it("Copy version button writes to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderWithProviders(<VersionSettings />);
    await userEvent.click(screen.getByLabelText("Copy version"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("0.0.0"));
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

  it("Check now → up to date", async () => {
    mockCheck.mockResolvedValue(null);
    renderWithProviders(<VersionSettings />);
    await userEvent.click(screen.getByTestId("version-check"));
    await waitFor(() =>
      expect(screen.getByTestId("version-status")).toHaveTextContent("Up to date"),
    );
  });

  it("Check now → update available, then Install & restart", async () => {
    mockCheck.mockResolvedValue(fakeUpdate("2.0.0"));
    renderWithProviders(<VersionSettings />);
    await userEvent.click(screen.getByTestId("version-check"));
    await waitFor(() =>
      expect(screen.getByTestId("version-status")).toHaveTextContent("2.0.0"),
    );
    const install = await screen.findByTestId("version-install");
    await userEvent.click(install);
    await waitFor(() => expect(mockRelaunch).toHaveBeenCalledOnce());
  });

  it("Check now → error shows the failure message", async () => {
    mockCheck.mockRejectedValue(new Error("network down"));
    renderWithProviders(<VersionSettings />);
    await userEvent.click(screen.getByTestId("version-check"));
    await waitFor(() =>
      expect(screen.getByTestId("version-error")).toHaveTextContent("network down"),
    );
    expect(screen.getByTestId("version-status")).toHaveTextContent("Check failed");
  });

  it("Check now → unconfigured build degrades gracefully", async () => {
    mockCheck.mockRejectedValue(new Error("updater is not configured"));
    renderWithProviders(<VersionSettings />);
    await userEvent.click(screen.getByTestId("version-check"));
    await waitFor(() =>
      expect(screen.getByTestId("version-status")).toHaveTextContent("not configured"),
    );
    // No error row in the unconfigured path.
    expect(screen.queryByTestId("version-error")).not.toBeInTheDocument();
  });
});
