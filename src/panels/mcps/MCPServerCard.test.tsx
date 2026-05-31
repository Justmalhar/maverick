import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import MCPServerCard from "./MCPServerCard";
import { makeMCPServer } from "@/test/fixtures";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(listen).mockReset();
  vi.mocked(listen).mockResolvedValue(() => {});
});

afterEach(() => cleanup());

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
  });

  it("stop fail surfaces error", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("stop fail"));
    renderWithProviders(<MCPServerCard server={makeMCPServer({ status: "running" })} onChange={() => {}} />);
    await userEvent.click(screen.getByTestId("mcp-stop"));
    await waitFor(() => expect(screen.getByText(/stop fail/)).toBeInTheDocument());
  });

  it("restart fail surfaces error", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("restart fail"));
    renderWithProviders(<MCPServerCard server={makeMCPServer({ status: "running" })} onChange={() => {}} />);
    await userEvent.click(screen.getByTestId("mcp-restart"));
    await waitFor(() => expect(screen.getByText(/restart fail/)).toBeInTheDocument());
  });

  it("uses error variant for error and crashed states", () => {
    const { rerender } = renderWithProviders(
      <MCPServerCard server={makeMCPServer({ status: "error" })} onChange={() => {}} />
    );
    expect(screen.getByTestId("mcp-server-card")).toBeInTheDocument();
    rerender(<MCPServerCard server={makeMCPServer({ status: "crashed" })} onChange={() => {}} />);
    expect(screen.getByText("crashed")).toBeInTheDocument();
  });

  it("shows the restart count when a server has auto-restarted", () => {
    renderWithProviders(
      <MCPServerCard server={makeMCPServer({ status: "restarting", restarts: 3 })} onChange={() => {}} />
    );
    expect(screen.getByText("restarting")).toBeInTheDocument();
    expect(screen.getByTestId("mcp-restart-count")).toHaveTextContent("3");
  });

  it("toggles the logs viewer and pages output by offset", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ data: "first\n", nextOffset: 6, dropped: 0 } as never)
      .mockResolvedValue({ data: "", nextOffset: 6, dropped: 0 } as never);
    renderWithProviders(<MCPServerCard server={makeMCPServer({ status: "running" })} onChange={() => {}} />);
    await userEvent.click(screen.getByTestId("mcp-logs-toggle"));
    await waitFor(() => expect(screen.getByText(/first/)).toBeInTheDocument());
    expect(invoke).toHaveBeenCalledWith("mcp_logs", { name: "fs", sinceOffset: 0 });
    // Toggle closed again.
    await userEvent.click(screen.getByTestId("mcp-logs-toggle"));
    await waitFor(() => expect(screen.queryByTestId("mcp-logs")).not.toBeInTheDocument());
  });

  it("shows an empty-logs placeholder when no output has been captured", async () => {
    vi.mocked(invoke).mockResolvedValue({ data: "", nextOffset: 0, dropped: 0 } as never);
    renderWithProviders(<MCPServerCard server={makeMCPServer({ status: "running" })} onChange={() => {}} />);
    await userEvent.click(screen.getByTestId("mcp-logs-toggle"));
    await waitFor(() => expect(screen.getByText(/No output yet/)).toBeInTheDocument());
  });

  it("surfaces a logs fetch error", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("logs fail"));
    renderWithProviders(<MCPServerCard server={makeMCPServer({ status: "running" })} onChange={() => {}} />);
    await userEvent.click(screen.getByTestId("mcp-logs-toggle"));
    await waitFor(() => expect(screen.getByText(/logs fail/)).toBeInTheDocument());
  });

  it("refreshes when a matching mcp:status event fires (and ignores others)", async () => {
    let cb: ((e: { payload: unknown }) => void) | null = null;
    vi.mocked(listen).mockImplementation((async (_event: string, handler: (e: { payload: unknown }) => void) => {
      cb = handler;
      return () => {};
    }) as unknown as typeof listen);
    const onChange = vi.fn();
    renderWithProviders(<MCPServerCard server={makeMCPServer({ name: "fs", status: "running" })} onChange={onChange} />);
    await waitFor(() => expect(cb).not.toBeNull());
    cb!({ payload: { name: "other", status: "crashed", restarts: 1, exitCode: 1 } });
    expect(onChange).not.toHaveBeenCalled();
    cb!({ payload: { name: "fs", status: "restarting", restarts: 1, exitCode: 1 } });
    expect(onChange).toHaveBeenCalled();
  });

  it("tolerates a missing mcp:status event channel", async () => {
    vi.mocked(listen).mockRejectedValueOnce(new Error("no channel"));
    renderWithProviders(<MCPServerCard server={makeMCPServer({ status: "running" })} onChange={() => {}} />);
    expect(screen.getByTestId("mcp-server-card")).toBeInTheDocument();
  });
});
