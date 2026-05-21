import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import { SettingsNavRail, NAV_GROUPS } from "./SettingsNavRail";

describe("SettingsNavRail", () => {
  it("renders all groups and items", () => {
    renderWithProviders(<SettingsNavRail section="general" onSelect={() => {}} />);
    for (const group of NAV_GROUPS) {
      expect(screen.getByText(group.label)).toBeInTheDocument();
      for (const item of group.items) {
        expect(screen.getByTestId(`settings-nav-${item.id}`)).toBeInTheDocument();
      }
    }
  });

  it("marks the selected item with aria-current", () => {
    renderWithProviders(<SettingsNavRail section="version" onSelect={() => {}} />);
    expect(screen.getByTestId("settings-nav-version")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("settings-nav-general")).not.toHaveAttribute("aria-current", "page");
  });

  it("calls onSelect when an item is clicked", async () => {
    const onSelect = vi.fn();
    renderWithProviders(<SettingsNavRail section="general" onSelect={onSelect} />);
    await userEvent.click(screen.getByTestId("settings-nav-models"));
    expect(onSelect).toHaveBeenCalledWith("models");
  });

  it("filters items by search query", async () => {
    renderWithProviders(<SettingsNavRail section="general" onSelect={() => {}} />);
    await userEvent.type(screen.getByRole("searchbox"), "git");
    expect(screen.getByTestId("settings-nav-git")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-nav-models")).toBeNull();
  });

  it("keeps the selected group header visible even when its children filter out", async () => {
    renderWithProviders(<SettingsNavRail section="version" onSelect={() => {}} />);
    await userEvent.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.getByText("System")).toBeInTheDocument();
  });

  it("moves selection on arrow keys and fires onSelect on Enter", async () => {
    const onSelect = vi.fn();
    renderWithProviders(<SettingsNavRail section="general" onSelect={onSelect} />);
    const search = screen.getByRole("searchbox");
    search.focus();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalled();
    const first = onSelect.mock.calls[0][0];
    expect(typeof first).toBe("string");
  });
});
