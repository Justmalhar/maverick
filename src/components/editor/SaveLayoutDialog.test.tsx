import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import { SaveLayoutDialog } from "./SaveLayoutDialog";

describe("SaveLayoutDialog", () => {
  it("renders when open and hides when closed", () => {
    const { rerender } = renderWithProviders(
      <SaveLayoutDialog open={false} onOpenChange={() => {}} onSave={() => {}} />
    );
    expect(screen.queryByTestId("save-layout-dialog")).toBeNull();
    rerender(<SaveLayoutDialog open onOpenChange={() => {}} onSave={() => {}} />);
    expect(screen.getByTestId("save-layout-dialog")).toBeInTheDocument();
  });

  it("disables Save until a non-blank name is entered", async () => {
    renderWithProviders(<SaveLayoutDialog open onOpenChange={() => {}} onSave={() => {}} />);
    expect(screen.getByTestId("save-layout-confirm")).toBeDisabled();
    await userEvent.type(screen.getByTestId("save-layout-name"), "   ");
    expect(screen.getByTestId("save-layout-confirm")).toBeDisabled();
    await userEvent.type(screen.getByTestId("save-layout-name"), "My Layout");
    expect(screen.getByTestId("save-layout-confirm")).not.toBeDisabled();
  });

  it("saves the trimmed name and closes", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    renderWithProviders(
      <SaveLayoutDialog open onOpenChange={onOpenChange} onSave={onSave} />
    );
    await userEvent.type(screen.getByTestId("save-layout-name"), "  Trimmed  ");
    await userEvent.click(screen.getByTestId("save-layout-confirm"));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Trimmed"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("submits via Enter inside the form", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<SaveLayoutDialog open onOpenChange={() => {}} onSave={onSave} />);
    await userEvent.type(screen.getByTestId("save-layout-name"), "via-enter{Enter}");
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("via-enter"));
  });

  it("does not save when the name is blank on submit", async () => {
    const onSave = vi.fn();
    renderWithProviders(<SaveLayoutDialog open onOpenChange={() => {}} onSave={onSave} />);
    // Force a submit while blank via Enter on the input.
    await userEvent.type(screen.getByTestId("save-layout-name"), "{Enter}");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("uses defaultName as the initial value", () => {
    renderWithProviders(
      <SaveLayoutDialog open onOpenChange={() => {}} onSave={() => {}} defaultName="seed" />
    );
    expect(screen.getByTestId("save-layout-name")).toHaveValue("seed");
  });

  it("cancel closes without saving", async () => {
    const onSave = vi.fn();
    const onOpenChange = vi.fn();
    renderWithProviders(
      <SaveLayoutDialog open onOpenChange={onOpenChange} onSave={onSave} />
    );
    await userEvent.click(screen.getByTestId("save-layout-cancel"));
    expect(onSave).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("ignores re-submit while a save is in flight", async () => {
    let resolveSave!: () => void;
    const onSave = vi.fn(() => new Promise<void>((r) => { resolveSave = r; }));
    renderWithProviders(<SaveLayoutDialog open onOpenChange={() => {}} onSave={onSave} />);
    await userEvent.type(screen.getByTestId("save-layout-name"), "x");
    await userEvent.click(screen.getByTestId("save-layout-confirm"));
    // Button shows the saving label and is disabled mid-flight.
    expect(screen.getByTestId("save-layout-confirm")).toBeDisabled();
    resolveSave();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });
});
