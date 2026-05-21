import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { SettingsSearchInput } from "./SettingsSearchInput";

describe("SettingsSearchInput", () => {
  it("emits onChange as user types", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <SettingsSearchInput value="" onChange={onChange} />,
    );
    const input = screen.getByRole("searchbox");
    await userEvent.type(input, "a");
    expect(onChange).toHaveBeenLastCalledWith("a");
  });

  it("renders the placeholder", () => {
    renderWithProviders(
      <SettingsSearchInput value="" onChange={() => {}} placeholder="Search…" />,
    );
    expect(screen.getByPlaceholderText("Search…")).toBeInTheDocument();
  });
});
