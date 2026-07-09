import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import ModelsSettings from "./ModelsSettings";
import { _resetSettingsStoreForTests } from "@/lib/stores/settings";
import * as tauri from "@/lib/tauri";

describe("ModelsSettings", () => {
  beforeEach(() => {
    _resetSettingsStoreForTests();
    vi.spyOn(tauri, "listOllamaModels").mockResolvedValue([
      { id: "llama3:latest", label: "llama3:latest" },
    ]);
  });

  it("renders one picker per catalog provider with a model list, plus Ollama", () => {
    renderWithProviders(<ModelsSettings />);
    expect(screen.getByTestId("model-claude-code")).toBeInTheDocument();
    expect(screen.getByTestId("model-codex")).toBeInTheDocument();
    expect(screen.getByTestId("model-gemini")).toBeInTheDocument();
    expect(screen.getByTestId("model-ollama")).toBeInTheDocument();
  });

  it("does not render a picker for providers with no models yet", () => {
    renderWithProviders(<ModelsSettings />);
    expect(screen.queryByTestId("model-aider")).not.toBeInTheDocument();
    expect(screen.queryByTestId("model-opencode")).not.toBeInTheDocument();
    expect(screen.queryByTestId("model-antigravity")).not.toBeInTheDocument();
  });

  it("does not render a 'pi' picker", () => {
    renderWithProviders(<ModelsSettings />);
    expect(screen.queryByTestId("model-pi")).not.toBeInTheDocument();
  });

  it("changes the Claude Code default model via select", async () => {
    renderWithProviders(<ModelsSettings />);
    const trigger = screen.getByTestId("model-claude-code");
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole("option", { name: /sonnet 5/i }));
    expect(trigger).toHaveTextContent(/Sonnet 5/i);
  });

  it("Ollama row fetches and lists live models", async () => {
    renderWithProviders(<ModelsSettings />);
    await waitFor(() => expect(tauri.listOllamaModels).toHaveBeenCalled());
    const trigger = screen.getByTestId("model-ollama");
    await userEvent.click(trigger);
    expect(await screen.findByRole("option", { name: "llama3:latest" })).toBeInTheDocument();
  });

  it("Ollama row shows an empty state when no models are installed or ollama is unavailable", async () => {
    vi.spyOn(tauri, "listOllamaModels").mockResolvedValue([]);
    renderWithProviders(<ModelsSettings />);
    await waitFor(() => expect(tauri.listOllamaModels).toHaveBeenCalled());
    expect(screen.getByTestId("model-ollama-empty")).toBeInTheDocument();
  });
});
