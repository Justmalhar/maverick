import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";

// Windows has no Command key — the table must render Ctrl-based chords, never ⌘.
vi.mock("@/hooks/useOSPlatform", () => ({ useOSPlatform: () => "windows" }));

import KeybindingsSettings from "./KeybindingsSettings";

describe("KeybindingsSettings", () => {
  it("renders categories and filters via search", () => {
    renderWithProviders(<KeybindingsSettings />);
    expect(screen.getByTestId("keybindings-settings")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("keybindings-search"), { target: { value: "git" } });
    expect(screen.getByTestId("keybinding-view.git")).toBeInTheDocument();
  });

  it("renders Ctrl-based chords and never the Command glyph on Windows", () => {
    renderWithProviders(<KeybindingsSettings />);
    const section = screen.getByTestId("keybindings-settings");
    expect(section.textContent).toContain("Ctrl+Shift+K");
    expect(section.textContent).not.toContain("⌘");
    expect(section.textContent).not.toContain("⌥");
  });
});
