import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen } from "@/test/utils";
import SettingsPanel from "./SettingsPanel";

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue([] as never);
  window.history.replaceState({}, "", "/");
});

describe("SettingsPanel", () => {
  it("renders the panel and starts on General", () => {
    renderWithProviders(<SettingsPanel onClose={() => {}} />);
    expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
    expect(screen.getByTestId("general-settings")).toBeInTheDocument();
  });

  it("switches to each section via nav", async () => {
    renderWithProviders(<SettingsPanel onClose={() => {}} />);
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

  it("persists section to ?settings= URL param", async () => {
    renderWithProviders(<SettingsPanel onClose={() => {}} />);
    await userEvent.click(screen.getByTestId("settings-nav-account"));
    expect(new URLSearchParams(window.location.search).get("settings")).toBe("account");
  });

  it("restores the section from ?settings= on mount", () => {
    window.history.replaceState({}, "", "/?settings=appearance");
    renderWithProviders(<SettingsPanel onClose={() => {}} />);
    expect(screen.getByTestId("appearance-settings")).toBeInTheDocument();
  });

  it("supports controlled open/onOpenChange", async () => {
    const onOpenChange = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <SettingsPanel open onOpenChange={onOpenChange} onClose={onClose} />,
    );
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onClose).toHaveBeenCalled();
  });
});
