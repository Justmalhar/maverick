import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { SettingsFooter } from "./SettingsFooter";

describe("SettingsFooter", () => {
  it("invokes onOpenFile when Open settings file is clicked", async () => {
    const onOpenFile = vi.fn();
    renderWithProviders(<SettingsFooter status="idle" onOpenFile={onOpenFile} />);
    await userEvent.click(screen.getByRole("button", { name: /open settings file/i }));
    expect(onOpenFile).toHaveBeenCalled();
  });

  it("renders status labels for each state", () => {
    const onOpenFile = vi.fn();
    const { rerender } = renderWithProviders(
      <SettingsFooter status="saving" onOpenFile={onOpenFile} />,
    );
    expect(screen.getByText(/saving/i)).toBeInTheDocument();
    rerender(<SettingsFooter status="saved" onOpenFile={onOpenFile} />);
    expect(screen.getByText(/saved/i)).toBeInTheDocument();
    rerender(<SettingsFooter status="error" onOpenFile={onOpenFile} errorMessage="boom" />);
    expect(screen.getByText(/save failed/i)).toBeInTheDocument();
  });
});
