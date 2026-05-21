import { describe, it, expect } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { ToolCallSummary } from "./ToolCallSummary";

describe("ToolCallSummary", () => {
  it("renders nothing when empty", () => {
    const { container } = renderWithProviders(<ToolCallSummary toolCalls={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("toggles open and renders single + plural labels", async () => {
    renderWithProviders(
      <ToolCallSummary toolCalls={[{ name: "read", input: "stuff" }]} />
    );
    expect(screen.getByText("1 tool call")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("read")).toBeInTheDocument();
    expect(screen.getByText("stuff")).toBeInTheDocument();
  });

  it("renders plural label and skips input when missing", async () => {
    renderWithProviders(
      <ToolCallSummary toolCalls={[{ name: "a" }, { name: "b" }]} />
    );
    expect(screen.getByText("2 tool calls")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getAllByText(/a|b/).length).toBeGreaterThan(0);
  });
});
