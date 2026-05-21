import { describe, it, expect } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import TerminalPresets from "./TerminalPresets";

describe("TerminalPresets", () => {
  it("adds + renames + edits + removes a custom preset", async () => {
    renderWithProviders(<TerminalPresets />);
    await userEvent.click(screen.getByTestId("terminal-add"));
    const customBlock = screen.getByTestId("terminal-preset-custom-8");
    const inputs = customBlock.querySelectorAll("input");
    // Rename — covers the `(e) => update(p.id, { name: e.target.value })` closure on the name input
    fireEvent.change(inputs[0], { target: { value: "my-shell" } });
    fireEvent.change(inputs[1], { target: { value: "bash" } });
    fireEvent.change(inputs[2], { target: { value: "-l" } });
    await userEvent.click(customBlock.querySelector('[data-testid="terminal-remove"]')!);
  });

  it("disables name edit on builtins", () => {
    renderWithProviders(<TerminalPresets />);
    expect(screen.getByTestId("terminal-preset-claude").querySelector("input")).toBeDisabled();
  });
});
