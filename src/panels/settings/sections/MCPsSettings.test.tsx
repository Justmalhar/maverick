import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen } from "@/test/utils";
import MCPsSettings from "./MCPsSettings";

beforeEach(() => {
  vi.mocked(invoke).mockResolvedValue([] as never);
});

describe("MCPsSettings", () => {
  it("renders MCPs panel within settings", () => {
    renderWithProviders(<MCPsSettings />);
    expect(screen.getByTestId("mcps-settings")).toBeInTheDocument();
    expect(screen.getByTestId("mcps-panel")).toBeInTheDocument();
  });
});
