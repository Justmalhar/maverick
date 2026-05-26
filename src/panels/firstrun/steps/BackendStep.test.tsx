import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { BackendStep } from "./BackendStep";

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

const detected = [
  { name: "claude-code", command: "claude", installed: true, path: "/usr/local/bin/claude", version: "1.2.3" },
  { name: "codex", command: "codex", installed: false, path: null, version: null },
  { name: "gemini", command: "gemini", installed: true, path: "/opt/gemini", version: "0.5.0" },
  { name: "aider", command: "aider", installed: false, path: null, version: null },
  { name: "ollama", command: "ollama", installed: true, path: "/usr/bin/ollama", version: "0.4.1" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BackendStep", () => {
  it("calls detect_backends on mount and renders one row per backend", async () => {
    mockInvoke.mockResolvedValueOnce(detected);
    render(<BackendStep />);
    expect(await screen.findByText("claude-code")).toBeInTheDocument();
    expect(screen.getByText("codex")).toBeInTheDocument();
    expect(screen.getByText("gemini")).toBeInTheDocument();
    expect(screen.getByText("aider")).toBeInTheDocument();
    expect(screen.getByText("ollama")).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith("detect_backends");
  });

  it("installed backends show version pill; missing show 'not found'", async () => {
    mockInvoke.mockResolvedValueOnce(detected);
    render(<BackendStep />);
    expect(await screen.findByText("1.2.3")).toBeInTheDocument();
    expect(screen.getAllByText(/not found/i).length).toBe(2);
  });

  it("selecting a backend writes via bootstrap_update_settings", async () => {
    mockInvoke.mockResolvedValueOnce(detected); // detect_backends
    render(<BackendStep />);
    await screen.findByText("claude-code");

    mockInvoke.mockResolvedValueOnce({}); // update_settings
    await userEvent.click(screen.getByRole("radio", { name: /claude-code/i }));
    expect(mockInvoke).toHaveBeenCalledWith(
      "bootstrap_update_settings",
      expect.objectContaining({ patch: { defaultBackend: "claude-code" } })
    );
  });

  it("handles non-array detect_backends result by rendering empty list", async () => {
    mockInvoke.mockResolvedValueOnce(null as unknown as never);
    render(<BackendStep />);
    // No backends rendered, no crash; the empty <ul> exists once loading completes.
    await screen.findByText(/scanned/i); // header text always present
    expect(screen.queryAllByRole("radio").length).toBe(0);
  });

  it("renders 'installed' fallback when version is null", async () => {
    mockInvoke.mockResolvedValueOnce([
      { name: "ollama", command: "ollama", installed: true, path: "/opt/ollama", version: null },
    ]);
    render(<BackendStep />);
    expect(await screen.findByText("installed")).toBeInTheDocument();
  });

  it("renders empty list on detect_backends error (no infinite spinner)", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("boom"));
    render(<BackendStep />);
    // Wait for header text to be present (always rendered)
    await screen.findByText(/scanned/i);
    // Give the catch handler time to fire
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryAllByRole("radio").length).toBe(0);
  });
});
