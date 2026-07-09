import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { ThinkingRow } from "./ThinkingRow";

describe("ThinkingRow", () => {
  it("shows a truncated summary chip and expands to the full text on click", async () => {
    const part = { type: "thinking" as const, summary: "Considering approach\nSecond line of thought" };
    render(<ThinkingRow part={part} />);
    expect(screen.getByText("Considering approach")).toBeInTheDocument();
    expect(screen.queryByText(/Second line of thought/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/Second line of thought/)).toBeInTheDocument();
  });

  it("renders nothing for a blank summary", () => {
    const part = { type: "thinking" as const, summary: "   " };
    const { container } = render(<ThinkingRow part={part} />);
    expect(container).toBeEmptyDOMElement();
  });
});
