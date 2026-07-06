import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import SquadBroadcastDialog from "./SquadBroadcastDialog";
import { sendAgentPrompt } from "@/lib/ai-actions";
import { makeWorkspace } from "@/test/fixtures";
import type { Squad } from "@/lib/ipc";

vi.mock("@/lib/ai-actions", () => ({
  sendAgentPrompt: vi.fn(),
}));

const SQUAD: Squad = { id: "s1", projectId: "p1", name: "auth-refactor", memberWorkspaceIds: ["ws-1", "ws-2"], createdAt: 0 };
const MEMBERS = [
  makeWorkspace({ id: "ws-1", title: "backend", agentBackend: "claude", worktreePath: "/wt1" }),
  makeWorkspace({ id: "ws-2", title: "frontend", agentBackend: "codex", worktreePath: "/wt2" }),
];

beforeEach(() => {
  vi.mocked(sendAgentPrompt).mockReset();
});

describe("SquadBroadcastDialog", () => {
  it("sends the prompt to every member and reports success", async () => {
    vi.mocked(sendAgentPrompt).mockResolvedValue({ ran: true });
    renderWithProviders(
      <SquadBroadcastDialog open squad={SQUAD} memberWorkspaces={MEMBERS} onOpenChange={() => {}} />
    );
    await userEvent.type(screen.getByTestId("squad-broadcast-prompt"), "run the tests");
    await userEvent.click(screen.getByTestId("squad-broadcast-send"));
    await waitFor(() => expect(sendAgentPrompt).toHaveBeenCalledTimes(2));
    expect(sendAgentPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ target: { workspaceId: "ws-1", backend: "claude", cwd: "/wt1" }, prompt: "run the tests" })
    );
    await waitFor(() => expect(screen.getByTestId("squad-broadcast-result")).toHaveTextContent("Sent to: backend, frontend"));
  });

  it("reports members with no live agent as unreachable", async () => {
    vi.mocked(sendAgentPrompt)
      .mockResolvedValueOnce({ ran: true })
      .mockResolvedValueOnce({ ran: false });
    renderWithProviders(
      <SquadBroadcastDialog open squad={SQUAD} memberWorkspaces={MEMBERS} onOpenChange={() => {}} />
    );
    await userEvent.type(screen.getByTestId("squad-broadcast-prompt"), "go");
    await userEvent.click(screen.getByTestId("squad-broadcast-send"));
    await waitFor(() => expect(screen.getByTestId("squad-broadcast-result")).toHaveTextContent("frontend"));
    expect(screen.getByTestId("squad-broadcast-result")).toHaveTextContent(/No live agent/);
  });

  it("calls onAgentFocus for each reachable member", async () => {
    vi.mocked(sendAgentPrompt).mockImplementation(async (opts) => {
      opts.onAgentFocus?.();
      return { ran: true };
    });
    const onAgentFocus = vi.fn();
    renderWithProviders(
      <SquadBroadcastDialog open squad={SQUAD} memberWorkspaces={MEMBERS} onOpenChange={() => {}} onAgentFocus={onAgentFocus} />
    );
    await userEvent.type(screen.getByTestId("squad-broadcast-prompt"), "go");
    await userEvent.click(screen.getByTestId("squad-broadcast-send"));
    await waitFor(() => expect(onAgentFocus).toHaveBeenCalledWith("ws-1"));
    expect(onAgentFocus).toHaveBeenCalledWith("ws-2");
  });

  it("disables Send when the prompt is empty or there are no members", () => {
    renderWithProviders(
      <SquadBroadcastDialog open squad={SQUAD} memberWorkspaces={MEMBERS} onOpenChange={() => {}} />
    );
    expect(screen.getByTestId("squad-broadcast-send")).toBeDisabled();
  });

  it("disables Send when the squad has no members", async () => {
    renderWithProviders(
      <SquadBroadcastDialog open squad={SQUAD} memberWorkspaces={[]} onOpenChange={() => {}} />
    );
    await userEvent.type(screen.getByTestId("squad-broadcast-prompt"), "go");
    expect(screen.getByTestId("squad-broadcast-send")).toBeDisabled();
  });

  it("resets the prompt and result when closed", async () => {
    vi.mocked(sendAgentPrompt).mockResolvedValue({ ran: true });
    const onOpenChange = vi.fn();
    renderWithProviders(
      <SquadBroadcastDialog open squad={SQUAD} memberWorkspaces={MEMBERS} onOpenChange={onOpenChange} />
    );
    await userEvent.type(screen.getByTestId("squad-broadcast-prompt"), "go");
    await userEvent.click(screen.getByTestId("squad-broadcast-send"));
    await waitFor(() => expect(screen.getByTestId("squad-broadcast-result")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("squad-broadcast-close"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
