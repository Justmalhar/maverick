import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor, act } from "@/test/utils";

const minimize = vi.fn().mockResolvedValue(undefined);
const toggleMaximize = vi.fn().mockResolvedValue(undefined);
const close = vi.fn().mockResolvedValue(undefined);
const isMaximized = vi.fn().mockResolvedValue(false);

// onResized captures the callback so tests can fire a synthetic resize event.
let capturedResizeCallback: (() => Promise<void>) | undefined;
const onResized = vi.fn().mockImplementation((cb: () => Promise<void>) => {
  capturedResizeCallback = cb;
  return Promise.resolve(() => {});
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ minimize, toggleMaximize, close, isMaximized, onResized }),
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

  it("shows a restore glyph + label when the window is maximized", async () => {
    isMaximized.mockResolvedValue(true);
    renderWithProviders(<WindowControls />);
    expect(await screen.findByLabelText("restore")).toBeInTheDocument();
    isMaximized.mockResolvedValue(false);
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

  it("updates maximize state when the resize event fires (onResized callback, line 32)", async () => {
    // First render: not maximized
    isMaximized.mockResolvedValue(false);
    renderWithProviders(<WindowControls />);
    // Wait for the useEffect to fire and onResized to be registered
    await waitFor(() => expect(onResized).toHaveBeenCalled());

    // Simulate the window being maximized via a native resize event
    isMaximized.mockResolvedValue(true);
    await act(async () => {
      await capturedResizeCallback?.();
    });

    expect(await screen.findByLabelText("restore")).toBeInTheDocument();
  });
});
