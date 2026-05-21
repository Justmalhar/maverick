import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { StatusBarItem } from "./StatusBarItem";

describe("StatusBarItem", () => {
  it("renders as a div by default and supports the icon slot", () => {
    renderWithProviders(
      <StatusBarItem icon={<span data-testid="icon">i</span>} testId="x" tone="success">
        hello
      </StatusBarItem>
    );
    expect(screen.getByTestId("x")).toHaveTextContent("hello");
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("renders as a button with onClick handler", async () => {
    const onClick = vi.fn();
    renderWithProviders(
      <StatusBarItem testId="b" tone="destructive" className="extra" onClick={onClick}>
        x
      </StatusBarItem>
    );
    const btn = screen.getByTestId("b") as HTMLButtonElement;
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.className).toMatch(/extra/);
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });

  it.each(["default", "success", "warning", "destructive", "info"] as const)(
    "renders tone %s",
    (tone) => {
      renderWithProviders(
        <StatusBarItem testId={`tone-${tone}`} tone={tone}>x</StatusBarItem>
      );
      expect(screen.getByTestId(`tone-${tone}`)).toBeInTheDocument();
    }
  );
});
