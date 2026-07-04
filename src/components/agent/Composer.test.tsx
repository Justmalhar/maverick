import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Composer } from "./Composer";
import { useAgentStore, emptySession } from "@/state/agent-store";
import type { Workspace } from "@/lib/ipc";
import * as tauri from "@/lib/tauri";

vi.mock("@/lib/tauri", () => ({
  agentSend: vi.fn().mockResolvedValue({ queued: false }),
  agentInterrupt: vi.fn().mockResolvedValue({ ok: true }),
  agentQueueRemove: vi.fn().mockResolvedValue({ ok: true }),
  agentSetOptions: vi.fn().mockResolvedValue({ ok: true }),
  agentCapabilities: vi.fn().mockResolvedValue({
    models: [{ id: "default", label: "Default" }, { id: "claude-opus-4-8", label: "Opus 4.8" }],
    reasoningLevels: [{ id: "default", label: "Default" }, { id: "high", label: "High" }],
    slashCommands: [{ name: "/compact", description: "Compact context" }],
    supportsInterrupt: true,
    supportsConversationRewind: true,
  }),
  agentAttachmentSave: vi.fn(),
  fileSearch: vi.fn().mockResolvedValue({ hits: [], truncated: false }),
}));
vi.mock("@/lib/file-drop", () => ({ registerFileDropTarget: vi.fn().mockReturnValue(() => {}) }));

const ws: Workspace = { id: "w1", projectId: "p1", branch: "b", agentBackend: "claude", worktreePath: "/w", status: "idle", sessionId: "s1", mode: "agent" };

beforeEach(() => {
  vi.clearAllMocks();
  useAgentStore.setState({ sessions: { s1: { ...emptySession(), hydrated: true } } });
});

describe("Composer", () => {
  it("sends trimmed text on Enter and clears the draft", async () => {
    render(<Composer workspace={ws} />);
    const box = await screen.findByRole("textbox", { name: "Message agent" });
    await userEvent.type(box, "  hello agent  {Enter}");
    expect(tauri.agentSend).toHaveBeenCalledWith("s1", [{ type: "text", text: "hello agent" }]);
    expect(box).toHaveValue("");
  });

  it("Shift+Enter inserts a newline instead of sending", async () => {
    render(<Composer workspace={ws} />);
    const box = await screen.findByRole("textbox", { name: "Message agent" });
    await userEvent.type(box, "line1{Shift>}{Enter}{/Shift}line2");
    expect(tauri.agentSend).not.toHaveBeenCalled();
    expect(box).toHaveValue("line1\nline2");
  });

  it("does not send an empty draft", async () => {
    render(<Composer workspace={ws} />);
    const box = await screen.findByRole("textbox", { name: "Message agent" });
    await userEvent.type(box, "   {Enter}");
    expect(tauri.agentSend).not.toHaveBeenCalled();
  });

  it("shows Stop while working; clicking it interrupts; Escape also interrupts", async () => {
    useAgentStore.setState({ sessions: { s1: { ...emptySession(), status: "working", hydrated: true } } });
    render(<Composer workspace={ws} />);
    const stop = await screen.findByRole("button", { name: "Stop" });
    await userEvent.click(stop);
    expect(tauri.agentInterrupt).toHaveBeenCalledWith("s1");
    const box = screen.getByRole("textbox", { name: "Message agent" });
    box.focus();
    await userEvent.keyboard("{Escape}");
    expect(tauri.agentInterrupt).toHaveBeenCalledTimes(2);
  });

  it("renders queued messages with a remove control", async () => {
    useAgentStore.setState({
      sessions: { s1: { ...emptySession(), hydrated: true, status: "working", queue: [{ id: "q1", parts: [{ type: "text", text: "queued msg" }], createdAt: 1 }] } },
    });
    render(<Composer workspace={ws} />);
    expect(await screen.findByText("queued msg")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove queued message" }));
    expect(tauri.agentQueueRemove).toHaveBeenCalledWith("s1", "q1");
  });

  it("selecting a model updates local state and persists via agentSetOptions", async () => {
    render(<Composer workspace={ws} />);
    await userEvent.click(await screen.findByRole("button", { name: /model: default/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Opus 4.8" }));
    expect(tauri.agentSetOptions).toHaveBeenCalledWith("s1", { model: "claude-opus-4-8" });
    expect(useAgentStore.getState().sessions.s1.model).toBe("claude-opus-4-8");
  });

  it("selecting a reasoning level updates local state and persists via agentSetOptions", async () => {
    render(<Composer workspace={ws} />);
    await userEvent.click(await screen.findByRole("button", { name: /reasoning level: default/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "High" }));
    expect(tauri.agentSetOptions).toHaveBeenCalledWith("s1", { reasoningLevel: "high" });
    expect(useAgentStore.getState().sessions.s1.reasoningLevel).toBe("high");
  });

  it("logs but does not throw when agentSend rejects, and the draft stays cleared", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(tauri.agentSend).mockRejectedValueOnce(new Error("network down"));
    render(<Composer workspace={ws} />);
    const box = await screen.findByRole("textbox", { name: "Message agent" });
    await userEvent.type(box, "hello{Enter}");
    await waitFor(() => expect(consoleError).toHaveBeenCalledWith("[agent] send failed", expect.any(Error)));
    expect(box).toHaveValue("");
    consoleError.mockRestore();
  });
});
