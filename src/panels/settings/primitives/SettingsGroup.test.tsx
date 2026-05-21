import { describe, it, expect } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import { SettingsGroup } from "./SettingsGroup";

describe("SettingsGroup", () => {
  it("renders title, description, and children", () => {
    renderWithProviders(
      <SettingsGroup title="Defaults" description="How new workspaces start.">
        <div data-testid="child-1">A</div>
        <div data-testid="child-2">B</div>
      </SettingsGroup>,
    );
    expect(screen.getByText("Defaults")).toBeInTheDocument();
    expect(screen.getByText("How new workspaces start.")).toBeInTheDocument();
    expect(screen.getByTestId("child-1")).toBeInTheDocument();
    expect(screen.getByTestId("child-2")).toBeInTheDocument();
  });

  it("renders without title or description", () => {
    renderWithProviders(
      <SettingsGroup>
        <div data-testid="only-child">solo</div>
      </SettingsGroup>,
    );
    expect(screen.getByTestId("only-child")).toBeInTheDocument();
  });
});
