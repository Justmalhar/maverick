import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import GeneralSettings from "./GeneralSettings";
import { _resetSettingsStoreForTests } from "@/lib/stores/settings";

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
});
