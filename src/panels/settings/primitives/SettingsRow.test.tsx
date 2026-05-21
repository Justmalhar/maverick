import { describe, it, expect } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import { SettingsRow } from "./SettingsRow";

describe("SettingsRow", () => {
  it("renders title, description, and control", () => {
    renderWithProviders(
      <SettingsRow
        title="Default backend"
        description="The AI CLI used when no preset is specified."
        control={<input data-testid="row-control" />}
      />,
    );
    expect(screen.getByText("Default backend")).toBeInTheDocument();
    expect(
      screen.getByText("The AI CLI used when no preset is specified."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("row-control")).toBeInTheDocument();
  });

  it("omits description block when not provided", () => {
    renderWithProviders(
      <SettingsRow title="Just a title" control={<input />} />,
    );
    expect(screen.getByText("Just a title")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-row-description")).toBeNull();
  });
});
