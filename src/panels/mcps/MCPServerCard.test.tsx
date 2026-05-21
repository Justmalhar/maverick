import { describe, it, expect, beforeEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import MCPServerCard from "./MCPServerCard";
import { makeMCPServer } from "@/test/fixtures";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("MCPServerCard", () => {
  it("renders stopped server and starts it", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ pid: 1 } as never);
    const onChange = vi.fn();
    renderWithProviders(<MCPServerCard server={makeMCPServer({ status: "stopped" })} onChange={onChange} />);
    await userEvent.click(screen.getByTestId("mcp-start"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it("renders running server with pid and stops it", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined as never);
    const onChange = vi.fn();
    renderWithProviders(<MCPServerCard server={makeMCPServer({ status: "running", pid: 42 })} onChange={onChange} />);
    expect(screen.getByText(/pid 42/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("mcp-stop"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it("restart calls stop+start", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined as never).mockResolvedValueOnce({ pid: 1 } as never);
    const onChange = vi.fn();
    renderWithProviders(<MCPServerCard server={makeMCPServer({ status: "running" })} onChange={onChange} />);
    await userEvent.click(screen.getByTestId("mcp-restart"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it("start fail surfaces error", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("start fail"));
    renderWithProviders(<MCPServerCard server={makeMCPServer({ status: "stopped" })} onChange={() => {}} />);
    await userEvent.click(screen.getByTestId("mcp-start"));
    await waitFor(() => expect(screen.getByText(/start fail/)).toBeInTheDocument());
    cleanup();
  });

  it("stop fail surfaces error", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("stop fail"));
    renderWithProviders(<MCPServerCard server={makeMCPServer({ status: "running" })} onChange={() => {}} />);
    await userEvent.click(screen.getByTestId("mcp-stop"));
    await waitFor(() => expect(screen.getByText(/stop fail/)).toBeInTheDocument());
    cleanup();
  });

  it("restart fail surfaces error", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("restart fail"));
    renderWithProviders(<MCPServerCard server={makeMCPServer({ status: "running" })} onChange={() => {}} />);
    await userEvent.click(screen.getByTestId("mcp-restart"));
    await waitFor(() => expect(screen.getByText(/restart fail/)).toBeInTheDocument());
  });

  it("uses error variant for error state", () => {
    renderWithProviders(<MCPServerCard server={makeMCPServer({ status: "error" })} onChange={() => {}} />);
    expect(screen.getByTestId("mcp-server-card")).toBeInTheDocument();
  });
});
