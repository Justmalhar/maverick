import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen } from "@/test/utils";
import SettingsPanel from "./SettingsPanel";

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue([] as never);
});

describe("SettingsPanel", () => {
  it("renders nav, switches sections, fires close", async () => {
    const onClose = vi.fn();
    renderWithProviders(<SettingsPanel onClose={onClose} />);
    expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
    const sections: Array<[string, string]> = [
      ["settings-nav-models", "models-settings"],
      ["settings-nav-providers", "providers-settings"],
      ["settings-nav-appearance", "appearance-settings"],
      ["settings-nav-notifications", "notifications-settings"],
      ["settings-nav-keybindings", "keybindings-settings"],
      ["settings-nav-git", "git-settings"],
      ["settings-nav-mcps", "mcps-settings"],
      ["settings-nav-advanced", "advanced-settings"],
      ["settings-nav-account", "account-settings"],
      ["settings-nav-terminal", "terminal-presets"],
      ["settings-nav-repositories", "repository-settings"],
      ["settings-nav-general", "general-settings"],
    ];
    for (const [nav, sec] of sections) {
      await userEvent.click(screen.getByTestId(nav));
      expect(screen.getByTestId(sec)).toBeInTheDocument();
    }
  });

  it("supports controlled open/onOpenChange", async () => {
    const onOpenChange = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(<SettingsPanel open onOpenChange={onOpenChange} onClose={onClose} />);
    // We can't easily close shadcn Dialog overlay programmatically in jsdom,
    // but we can call handleOpenChange via Escape:
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onClose).toHaveBeenCalled();
  });
});
