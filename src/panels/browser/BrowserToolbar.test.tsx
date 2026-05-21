import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import BrowserToolbar from "./BrowserToolbar";

function makeProps(overrides: Partial<React.ComponentProps<typeof BrowserToolbar>> = {}) {
  return {
    url: "https://x", onUrlChange: vi.fn(), onNavigate: vi.fn(),
    onBack: vi.fn(), onForward: vi.fn(), onRefresh: vi.fn(), onStop: vi.fn(),
    canBack: true, canForward: true, inspecting: false, onToggleInspect: vi.fn(),
    ...overrides,
  };
}

describe("BrowserToolbar", () => {
  it("invokes all callbacks", async () => {
    const props = makeProps();
    renderWithProviders(<BrowserToolbar {...props} />);
    await userEvent.click(screen.getByTestId("browser-back"));
    await userEvent.click(screen.getByTestId("browser-forward"));
    await userEvent.click(screen.getByTestId("browser-refresh"));
    await userEvent.click(screen.getByTestId("browser-stop"));
    await userEvent.click(screen.getByTestId("browser-inspect"));
    expect(props.onBack).toHaveBeenCalled();
    expect(props.onForward).toHaveBeenCalled();
    expect(props.onRefresh).toHaveBeenCalled();
    expect(props.onStop).toHaveBeenCalled();
    expect(props.onToggleInspect).toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("browser-url"), { target: { value: "y" } });
    expect(props.onUrlChange).toHaveBeenCalledWith("y");
    fireEvent.keyDown(screen.getByTestId("browser-url"), { key: "Enter" });
    expect(props.onNavigate).toHaveBeenCalled();
  });

  it("disables back/forward when blocked and shows inspect ring", () => {
    renderWithProviders(<BrowserToolbar {...makeProps({ canBack: false, canForward: false, inspecting: true })} />);
    expect(screen.getByTestId("browser-back")).toBeDisabled();
    expect(screen.getByTestId("browser-forward")).toBeDisabled();
    expect(screen.getByTestId("browser-inspect").className).toMatch(/ring-primary/);
  });
});
