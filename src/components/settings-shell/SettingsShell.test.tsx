import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { SettingsShell } from "./SettingsShell";

describe("SettingsShell", () => {
  it("renders title chip, nav, content, footer", () => {
    renderWithProviders(
      <SettingsShell
        open
        onOpenChange={() => {}}
        title="Project Settings · demo"
        nav={<div data-testid="rail" />}
        footer={<div data-testid="foot" />}
      >
        <div data-testid="body">Body</div>
      </SettingsShell>
    );
    expect(screen.getByText("Project Settings · demo")).toBeInTheDocument();
    expect(screen.getByTestId("rail")).toBeInTheDocument();
    expect(screen.getByTestId("body")).toBeInTheDocument();
    expect(screen.getByTestId("foot")).toBeInTheDocument();
  });

  it("calls onOpenChange(false) when dialog requests close", async () => {
    const handler = vi.fn();
    renderWithProviders(
      <SettingsShell open onOpenChange={handler} title="t" nav={<div />} footer={<div />}>
        <div />
      </SettingsShell>
    );
    await userEvent.keyboard("{Escape}");
    expect(handler).toHaveBeenCalledWith(false);
  });
});
