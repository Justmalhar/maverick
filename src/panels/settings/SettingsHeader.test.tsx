import { describe, it, expect } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import { SettingsHeader } from "./SettingsHeader";

describe("SettingsHeader", () => {
  it("renders title and description", () => {
    renderWithProviders(
      <SettingsHeader title="General" description="Defaults for new workspaces." />,
    );
    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
    expect(screen.getByText("Defaults for new workspaces.")).toBeInTheDocument();
  });

  it("renders a badge when provided", () => {
    renderWithProviders(<SettingsHeader title="Account" badge="Free" />);
    expect(screen.getByText("Free")).toBeInTheDocument();
  });
});
