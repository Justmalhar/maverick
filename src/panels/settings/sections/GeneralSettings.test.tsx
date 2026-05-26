import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import { invoke } from "@tauri-apps/api/core";
import GeneralSettings from "./GeneralSettings";
import { _resetSettingsStoreForTests, useSettingsStore } from "@/lib/stores/settings";

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

  it("shows custom binary path input when defaultBackend is 'other'", () => {
    useSettingsStore.setState({ values: { "general.defaultBackend": "other" }, status: "loaded", lastError: null, dirty: {} });
    renderWithProviders(<GeneralSettings />);
    expect(screen.getByTestId("general-default-backend-binpath")).toBeInTheDocument();
  });

  it("custom binary path input onChange updates the store value", () => {
    useSettingsStore.setState({ values: { "general.defaultBackend": "other" }, status: "loaded", lastError: null, dirty: {} });
    renderWithProviders(<GeneralSettings />);
    fireEvent.change(screen.getByTestId("general-default-backend-binpath"), { target: { value: "/usr/local/bin/myagent" } });
    expect(useSettingsStore.getState().values["general.defaultBackendBinPath"]).toBe("/usr/local/bin/myagent");
  });

  it("Run setup wizard button calls reset_first_run", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    renderWithProviders(<GeneralSettings />);
    await userEvent.click(screen.getByRole("button", { name: /run setup wizard/i }));
    expect(mockInvoke).toHaveBeenCalledWith("reset_first_run");
  });
});
