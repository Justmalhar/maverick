import { describe, it, expect } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import { SettingsFooter } from "./SettingsFooter";

describe("SettingsFooter", () => {
  it("renders status labels for each state", () => {
    const { rerender } = renderWithProviders(<SettingsFooter status="idle" />);
    expect(screen.getByText(/all changes saved/i)).toBeInTheDocument();
    rerender(<SettingsFooter status="saving" />);
    expect(screen.getByText(/saving/i)).toBeInTheDocument();
    rerender(<SettingsFooter status="saved" />);
    expect(screen.getByText(/saved/i)).toBeInTheDocument();
    rerender(<SettingsFooter status="error" errorMessage="boom" />);
    expect(screen.getByText(/save failed/i)).toBeInTheDocument();
  });
});
