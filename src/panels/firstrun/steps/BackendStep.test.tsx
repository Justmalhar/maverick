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
  { name: "opencode", command: "opencode", installed: true, path: "/usr/local/bin/opencode", version: "0.1.0" },
  { name: "antigravity", command: "agy", installed: false, path: null, version: null },
  { name: "ollama", command: "ollama", installed: true, path: "/usr/bin/ollama", version: "0.4.1" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BackendStep", () => {
  it("calls detect_backends on mount and renders friendly labels for every backend", async () => {
    mockInvoke.mockResolvedValueOnce(detected);
    render(<BackendStep />);
    // Use radio role so we don't collide with the SVG <title> inside each icon.
    expect(await screen.findByRole("radio", { name: "Claude Code" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Codex" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Gemini CLI" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Aider" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "OpenCode" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Antigravity" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Ollama" })).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith("detect_backends");
  });

  it("installed agents show the brand tagline (no version numbers); missing ones get a 'Not detected' group", async () => {
    mockInvoke.mockResolvedValueOnce(detected);
    render(<BackendStep />);
    expect(await screen.findByRole("radio", { name: "Claude Code" })).toBeInTheDocument();
    // Versions like "1.2.3" must NOT appear anywhere — we show the tagline instead.
    expect(screen.queryByText("1.2.3")).not.toBeInTheDocument();
    expect(screen.queryByText("0.5.0")).not.toBeInTheDocument();
    expect(screen.getByText(/not detected/i)).toBeInTheDocument();
    // Brand taglines are surfaced for the known installed agents.
    expect(screen.getByText(/anthropic's official/i)).toBeInTheDocument();
  });

  it("missing backends show an Install button", async () => {
    mockInvoke.mockResolvedValueOnce(detected);
    render(<BackendStep />);
    const buttons = await screen.findAllByRole("button", { name: /install/i });
    // codex + aider + antigravity are not installed in the fixture
    expect(buttons.length).toBe(3);
  });

  it("Install button opens the URL in the system browser via plugin-shell", async () => {
    const { open: shellOpen } = await import("@tauri-apps/plugin-shell");
    const openSpy = shellOpen as unknown as ReturnType<typeof vi.fn>;
    mockInvoke.mockResolvedValueOnce(detected);
    render(<BackendStep />);
    const buttons = await screen.findAllByRole("button", { name: /install/i });
    await userEvent.click(buttons[0]);
    expect(openSpy).toHaveBeenCalledWith(expect.stringMatching(/^https?:/));
  });

  it("selecting a backend writes via bootstrap_update_settings using the kebab-case id", async () => {
    mockInvoke.mockResolvedValueOnce(detected); // detect_backends
    render(<BackendStep />);
    const claudeRadio = await screen.findByRole("radio", { name: "Claude Code" });

    mockInvoke.mockResolvedValueOnce({}); // update_settings
    await userEvent.click(claudeRadio);
    expect(mockInvoke).toHaveBeenCalledWith(
      "bootstrap_update_settings",
      expect.objectContaining({ patch: { defaultBackend: "claude-code" } })
    );
  });

  it("handles non-array detect_backends result by rendering the empty hint", async () => {
    mockInvoke.mockResolvedValueOnce(null as unknown as never);
    render(<BackendStep />);
    expect(await screen.findByText(/no known agents found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("radio").length).toBe(0);
  });

  it("renders the brand tagline regardless of whether a version string was returned", async () => {
    mockInvoke.mockResolvedValueOnce([
      { name: "ollama", command: "ollama", installed: true, path: "/opt/ollama", version: null },
    ]);
    render(<BackendStep />);
    expect(await screen.findByText(/local models/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Installed$/)).not.toBeInTheDocument();
  });

  it("renders empty hint on detect_backends error (no infinite spinner)", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("boom"));
    render(<BackendStep />);
    expect(await screen.findByText(/no known agents found/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("radio").length).toBe(0);
  });

  it("unknown backend names render without an icon and fall back to the raw id", async () => {
    mockInvoke.mockResolvedValueOnce([
      { name: "unknown-future-agent", command: "uba", installed: false, path: null, version: null },
    ]);
    render(<BackendStep />);
    expect(
      await screen.findByRole("radio", { name: "unknown-future-agent" })
    ).toBeInTheDocument();
    expect(screen.getByText(/not detected on this machine/i)).toBeInTheDocument();
  });

  it("Install button click does not flip the radio in the same row", async () => {
    mockInvoke.mockResolvedValueOnce(detected);
    render(<BackendStep />);
    const codexRadio = await screen.findByRole("radio", { name: "Codex" });
    expect(codexRadio).not.toBeChecked();
    const codexInstall = (await screen.findAllByRole("button", { name: /install/i }))[0];
    await userEvent.click(codexInstall);
    // The label wrapping the radio + button shouldn't have toggled the disabled radio,
    // and crucially bootstrap_update_settings was NOT called.
    expect(codexRadio).not.toBeChecked();
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "bootstrap_update_settings",
      expect.anything()
    );
  });
});
