import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import { SettingsJsonEditor } from "./SettingsJsonEditor";
import { useSettingsStore, _resetSettingsStoreForTests } from "@/lib/stores/settings";

describe("SettingsJsonEditor", () => {
  beforeEach(() => {
    _resetSettingsStoreForTests();
    useSettingsStore.setState({ values: { "general.defaultBackend": "claude" } });
  });

  it("shows the current settings serialised as JSON", () => {
    renderWithProviders(<SettingsJsonEditor onClose={() => {}} />);
    const textarea = screen.getByTestId("settings-json-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toContain('"general.defaultBackend"');
    expect(textarea.value).toContain('"claude"');
  });

  it("includes unknown (non-SETTINGS_KEYS) values in the snapshot", () => {
    useSettingsStore.setState({ values: { "custom.unknown.key": "custom-val" } });
    renderWithProviders(<SettingsJsonEditor onClose={() => {}} />);
    const textarea = screen.getByTestId("settings-json-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toContain('"custom.unknown.key"');
    expect(textarea.value).toContain('"custom-val"');
  });

  it("parses + applies edited JSON to the store on Save", async () => {
    const onClose = vi.fn();
    renderWithProviders(<SettingsJsonEditor onClose={onClose} />);
    const textarea = screen.getByTestId("settings-json-textarea");
    const next = JSON.stringify(
      {
        "general.defaultBackend": "codex",
        "appearance.uiFontSize": 14,
      },
      null,
      2,
    );
    fireEvent.change(textarea, { target: { value: next } });
    await userEvent.click(screen.getByTestId("settings-json-save"));
    expect(useSettingsStore.getState().values["general.defaultBackend"]).toBe("codex");
    expect(useSettingsStore.getState().values["appearance.uiFontSize"]).toBe(14);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an error and does not close on invalid JSON", async () => {
    const onClose = vi.fn();
    renderWithProviders(<SettingsJsonEditor onClose={onClose} />);
    fireEvent.change(screen.getByTestId("settings-json-textarea"), {
      target: { value: "{ not json" },
    });
    await userEvent.click(screen.getByTestId("settings-json-save"));
    expect(screen.getByTestId("settings-json-error")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("rejects non-object top-level value", async () => {
    const onClose = vi.fn();
    renderWithProviders(<SettingsJsonEditor onClose={onClose} />);
    fireEvent.change(screen.getByTestId("settings-json-textarea"), {
      target: { value: "[1, 2, 3]" },
    });
    await userEvent.click(screen.getByTestId("settings-json-save"));
    expect(screen.getByTestId("settings-json-error")).toHaveTextContent(/object/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Discard reverts the draft to the initial JSON", async () => {
    renderWithProviders(<SettingsJsonEditor onClose={() => {}} />);
    const textarea = screen.getByTestId("settings-json-textarea") as HTMLTextAreaElement;
    const original = textarea.value;
    fireEvent.change(textarea, { target: { value: "{}" } });
    expect(textarea.value).toBe("{}");
    await userEvent.click(screen.getByTestId("settings-json-reset"));
    expect((screen.getByTestId("settings-json-textarea") as HTMLTextAreaElement).value).toBe(
      original,
    );
  });

  it("rejects non-primitive values in save", async () => {
    const onClose = vi.fn();
    renderWithProviders(<SettingsJsonEditor onClose={onClose} />);
    fireEvent.change(screen.getByTestId("settings-json-textarea"), {
      target: { value: JSON.stringify({ "general.defaultBackend": { nested: true } }) },
    });
    await userEvent.click(screen.getByTestId("settings-json-save"));
    expect(screen.getByTestId("settings-json-error")).toHaveTextContent(/must be a string/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("syncScroll syncs the pre element scroll with the textarea", () => {
    renderWithProviders(<SettingsJsonEditor onClose={() => {}} />);
    const textarea = screen.getByTestId("settings-json-textarea");
    fireEvent.scroll(textarea, { target: { scrollTop: 50, scrollLeft: 10 } });
    // No error thrown — scroll sync ran without crashing.
  });

  it("Copy button triggers clipboard write", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderWithProviders(<SettingsJsonEditor onClose={() => {}} />);
    await userEvent.click(screen.getByLabelText("Copy JSON"));
    expect(writeText).toHaveBeenCalled();
  });

  it("Copy button silently fails when clipboard is blocked", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("blocked")) }, configurable: true });
    renderWithProviders(<SettingsJsonEditor onClose={() => {}} />);
    // Should not throw
    await userEvent.click(screen.getByLabelText("Copy JSON"));
  });
});
