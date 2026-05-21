import { describe, it, expect, beforeEach } from "vitest";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import TerminalPresets from "./TerminalPresets";
import { _resetSettingsStoreForTests } from "@/lib/stores/settings";

describe("TerminalPresets", () => {
  beforeEach(() => _resetSettingsStoreForTests());

  it("renders one command row per provider and edits the Claude command", () => {
    renderWithProviders(<TerminalPresets />);
    expect(screen.getByTestId("terminal-claude")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-codex")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-gemini")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-pi")).toBeInTheDocument();

    const claude = screen.getByTestId("terminal-claude");
    fireEvent.change(claude, { target: { value: "claude --resume" } });
    expect(claude).toHaveValue("claude --resume");
  });
});
