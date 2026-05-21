import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import MCPsPanel from "./MCPsPanel";
import { makeMCPServer } from "@/test/fixtures";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("MCPsPanel", () => {
  it("loads list, shows empty state, refreshes", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([] as never).mockResolvedValueOnce([] as never);
    renderWithProviders(<MCPsPanel />);
    await waitFor(() => expect(screen.getByText(/No MCP servers configured/)).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("mcps-refresh"));
  });

  it("renders server cards", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([makeMCPServer({ name: "fs" })] as never);
    renderWithProviders(<MCPsPanel />);
    await waitFor(() => expect(screen.getByText("fs")).toBeInTheDocument());
  });

  it("captures errors", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("boom"));
    renderWithProviders(<MCPsPanel />);
    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument());
  });

  it("opens add dialog", async () => {
    vi.mocked(invoke).mockResolvedValue([] as never);
    renderWithProviders(<MCPsPanel />);
    await waitFor(() => expect(screen.getByText(/No MCP servers/)).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("mcps-add"));
    expect(await screen.findByTestId("add-mcp-dialog")).toBeInTheDocument();
  });
});
