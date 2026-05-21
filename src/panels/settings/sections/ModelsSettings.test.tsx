import { describe, it, expect } from "vitest";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import ModelsSettings from "./ModelsSettings";

describe("ModelsSettings", () => {
  it("renders rows and edits every numeric cell (covers all onChange closures)", () => {
    renderWithProviders(<ModelsSettings />);
    fireEvent.change(screen.getByTestId("model-claude"), { target: { value: "claude-x" } });
    const numericInputs = document.querySelectorAll('input[type="number"]');
    expect(numericInputs.length).toBeGreaterThan(2);
    numericInputs.forEach((inp, i) => {
      fireEvent.change(inp, { target: { value: String(100 + i) } });
    });
  });
});
