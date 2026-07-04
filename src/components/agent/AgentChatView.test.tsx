import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentChatView } from "./AgentChatView";
import { useAgentStore, emptySession } from "@/state/agent-store";
import type { Workspace } from "@/lib/ipc";

const hydrateAgentSession = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/agent/agent-events", () => ({
  hydrateAgentSession: (...a: unknown[]) => hydrateAgentSession(...a),
  ensureAgentEventSubscription: vi.fn(),
}));
vi.mock("@/lib/tauri", () => ({
  agentCapabilities: vi.fn().mockResolvedValue({ models: [], reasoningLevels: [], slashCommands: [], supportsInterrupt: true, supportsConversationRewind: true }),
  agentSend: vi.fn().mockResolvedValue({ queued: false }),
  agentInterrupt: vi.fn(),
  agentSetOptions: vi.fn(),
  agentQueueRemove: vi.fn(),
  agentRewind: vi.fn(),
  agentAttachmentSave: vi.fn(),
  fileSearch: vi.fn().mockResolvedValue({ hits: [], truncated: false }),
}));

const ws: Workspace = { id: "w1", projectId: "p1", branch: "b", agentBackend: "claude", worktreePath: "/w", status: "idle", sessionId: "sess1", mode: "agent" };

beforeEach(() => {
  hydrateAgentSession.mockClear();
  useAgentStore.setState({ sessions: { sess1: { ...emptySession(), hydrated: true } } });
});

describe("AgentChatView", () => {
  it("hydrates once when first visible", async () => {
    const { rerender } = render(<AgentChatView workspace={ws} visible={false} />);
    expect(hydrateAgentSession).not.toHaveBeenCalled();
    rerender(<AgentChatView workspace={ws} visible />);
    await waitFor(() => expect(hydrateAgentSession).toHaveBeenCalledWith("w1", "sess1"));
    rerender(<AgentChatView workspace={ws} visible={false} />);
    rerender(<AgentChatView workspace={ws} visible />);
    expect(hydrateAgentSession).toHaveBeenCalledTimes(1);
  });

  it("renders transcript + composer", async () => {
    render(<AgentChatView workspace={ws} visible />);
    expect(await screen.findByTestId("agent-composer")).toBeInTheDocument();
    expect(screen.getByTestId("agent-transcript")).toBeInTheDocument();
  });
});
