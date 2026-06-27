import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import { invoke } from "@tauri-apps/api/core";
import GeneralSettings from "./GeneralSettings";
import { _resetSettingsStoreForTests, useSettingsStore } from "@/lib/stores/settings";
import { useWorkbench } from "@/state/store";

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

describe("GeneralSettings", () => {
  beforeEach(() => _resetSettingsStoreForTests());

  it("renders and lets user edit all fields including restore toggle", async () => {
    renderWithProviders(<GeneralSettings />);
    fireEvent.change(screen.getByTestId("general-default-backend"), { target: { value: "codex" } });
    expect(screen.getByTestId("general-default-backend")).toHaveValue("codex");
    fireEvent.change(screen.getByTestId("general-default-branch"), { target: { value: "develop" } });
    expect(screen.getByTestId("general-default-branch")).toHaveValue("develop");
    fireEvent.change(screen.getByTestId("general-naming"), { target: { value: "{backend}" } });
    expect(screen.getByTestId("general-naming")).toHaveValue("{backend}");
    const toggle = screen.getByRole("switch", { name: /restore last session/i });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(toggle).not.toBeChecked();
  });

  it("startup command onChange updates the store value (missing function coverage)", () => {
    renderWithProviders(<GeneralSettings />);
    fireEvent.change(screen.getByTestId("general-startup-command"), { target: { value: "claude --dangerously-skip-permissions" } });
    expect(useSettingsStore.getState().values["general.startupCommand"]).toBe("claude --dangerously-skip-permissions");
  });

  it("shows custom binary path input when defaultBackend is 'other'", () => {
    // @ts-expect-error - test fixture intentionally bypasses the strict Status union
    useSettingsStore.setState({ values: { "general.defaultBackend": "other" }, status: "loaded", lastError: null, dirty: {} });
    renderWithProviders(<GeneralSettings />);
    expect(screen.getByTestId("general-default-backend-binpath")).toBeInTheDocument();
  });

  it("custom binary path input onChange updates the store value", () => {
    // @ts-expect-error - test fixture intentionally bypasses the strict Status union
    useSettingsStore.setState({ values: { "general.defaultBackend": "other" }, status: "loaded", lastError: null, dirty: {} });
    renderWithProviders(<GeneralSettings />);
    fireEvent.change(screen.getByTestId("general-default-backend-binpath"), { target: { value: "/usr/local/bin/myagent" } });
    expect(useSettingsStore.getState().values["general.defaultBackendBinPath"]).toBe("/usr/local/bin/myagent");
  });

  it("hides the shell selector on non-Windows platforms", () => {
    renderWithProviders(<GeneralSettings />);
    expect(screen.queryByTestId("general-default-shell")).not.toBeInTheDocument();
  });

  it("renders the Windows shell selector defaulting to PowerShell", () => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      configurable: true,
    });
    try {
      renderWithProviders(<GeneralSettings />);
      const select = screen.getByTestId("general-default-shell");
      expect(select).toBeInTheDocument();
      expect(select).toHaveTextContent("PowerShell");
    } finally {
      Reflect.deleteProperty(navigator, "userAgent");
    }
  });

  it("Run setup wizard button calls reset_first_run", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    renderWithProviders(<GeneralSettings />);
    await userEvent.click(screen.getByRole("button", { name: /run setup wizard/i }));
    expect(mockInvoke).toHaveBeenCalledWith("reset_first_run");
  });

  it("Run setup wizard button closes the Settings modal", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    useWorkbench.getState().setSettingsOpen(true);
    expect(useWorkbench.getState().settingsOpen).toBe(true);
    renderWithProviders(<GeneralSettings />);
    await userEvent.click(screen.getByRole("button", { name: /run setup wizard/i }));
    expect(useWorkbench.getState().settingsOpen).toBe(false);
  });
});
