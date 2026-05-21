import { describe, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import ModelsSettings from "./ModelsSettings";
import { _resetSettingsStoreForTests } from "@/lib/stores/settings";

describe("ModelsSettings", () => {
  beforeEach(() => _resetSettingsStoreForTests());

  it("renders one default-model picker per provider", () => {
    renderWithProviders(<ModelsSettings />);
    expect(screen.getByTestId("model-claude")).toBeInTheDocument();
    expect(screen.getByTestId("model-codex")).toBeInTheDocument();
    expect(screen.getByTestId("model-gemini")).toBeInTheDocument();
    expect(screen.getByTestId("model-pi")).toBeInTheDocument();
  });

  it("changes the Claude default model via select", async () => {
    renderWithProviders(<ModelsSettings />);
    const trigger = screen.getByTestId("model-claude");
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole("option", { name: /sonnet 4\.6/i }));
    expect(trigger).toHaveTextContent(/Sonnet 4\.6/i);
  });
});
