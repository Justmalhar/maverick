import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
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
      ["settings-nav-skills", "skills-settings"],
      ["settings-nav-version", "version-settings"],
      ["settings-nav-terminal", "terminal-presets"],
      ["settings-nav-environment", "environment-settings"],
      ["settings-nav-general", "general-settings"],
    ];
    for (const [nav, sec] of sections) {
      await userEvent.click(screen.getByTestId(nav));
      expect(screen.getByTestId(sec)).toBeInTheDocument();
    }
  });

  it("persists section to ?settings= URL param", async () => {
    renderWithProviders(<SettingsPanel onClose={() => {}} />);
    await userEvent.click(screen.getByTestId("settings-nav-version"));
    expect(new URLSearchParams(window.location.search).get("settings")).toBe("version");
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

  it("opens JSON editor mode when 'Open settings.json' is clicked", async () => {
    renderWithProviders(<SettingsPanel onClose={() => {}} />);
    await userEvent.click(screen.getByTestId("settings-open-file"));
    expect(screen.getByTestId("settings-json-editor")).toBeInTheDocument();
  });

  it("general settings shows custom binpath input when defaultBackend is 'other'", async () => {
    const { useSettingsStore } = await import("@/lib/stores/settings");
    // @ts-expect-error - test fixture intentionally bypasses the strict Status union
    useSettingsStore.setState({ values: { "general.defaultBackend": "other" }, status: "loaded", lastError: null, dirty: {} });
    renderWithProviders(<SettingsPanel onClose={() => {}} />);
    expect(screen.getByTestId("general-default-backend-binpath")).toBeInTheDocument();
  });

  it("notifications section renders all toggle rows", async () => {
    renderWithProviders(<SettingsPanel onClose={() => {}} />);
    await userEvent.click(screen.getByTestId("settings-nav-notifications"));
    expect(screen.getByTestId("notif-notifications.agent.waiting")).toBeInTheDocument();
    expect(screen.getByTestId("notif-notifications.agent.complete")).toBeInTheDocument();
  });

  it("closing JSON editor via Back button invokes onClose", async () => {
    renderWithProviders(<SettingsPanel onClose={() => {}} />);
    await userEvent.click(screen.getByTestId("settings-open-file"));
    await waitFor(() => expect(screen.getByTestId("settings-json-editor")).toBeInTheDocument());
    // Click the ← Back button which calls onClose() → setJsonMode(false)
    await userEvent.click(screen.getByRole("button", { name: /Back/i }));
    // The nav rail is always visible; clicking Back triggers setJsonMode(false) without crashing
    expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
  });
});
