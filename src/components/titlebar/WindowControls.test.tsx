import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";

const minimize = vi.fn().mockResolvedValue(undefined);
const toggleMaximize = vi.fn().mockResolvedValue(undefined);
const close = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ minimize, toggleMaximize, close }),
}));

import { WindowControls } from "./WindowControls";

describe("WindowControls", () => {
  it("renders three buttons and dispatches to Tauri window", async () => {
    renderWithProviders(<WindowControls className="extra" />);
    expect(screen.getByTestId("window-controls").className).toMatch(/extra/);
    await userEvent.click(screen.getByLabelText("minimize"));
    await userEvent.click(screen.getByLabelText("maximize"));
    await userEvent.click(screen.getByLabelText("close"));
    expect(minimize).toHaveBeenCalled();
    expect(toggleMaximize).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("silently swallows errors from the Tauri APIs", async () => {
    minimize.mockRejectedValueOnce(new Error("nope"));
    toggleMaximize.mockRejectedValueOnce(new Error("nope"));
    close.mockRejectedValueOnce(new Error("nope"));
    renderWithProviders(<WindowControls />);
    await userEvent.click(screen.getByLabelText("minimize"));
    await userEvent.click(screen.getByLabelText("maximize"));
    await userEvent.click(screen.getByLabelText("close"));
  });
});
