import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Transcript } from "./Transcript";
import { useAgentStore, emptySession } from "@/state/agent-store";
import type { AgentChatMessage, AgentPart } from "@/lib/ipc";

const S = "sess1";
const m = (id: string, turnId: string, role: AgentChatMessage["role"], text: string, parts?: AgentPart[]): AgentChatMessage => ({
  id, turnId, role, sessionId: S, parts: parts ?? [{ type: "text", text }], createdAt: 1,
});

beforeEach(() => {
  useAgentStore.setState({
    sessions: {
      [S]: {
        ...emptySession(),
        hydrated: true,
        messages: [m("u1", "t1", "user", "question one"), m("a1", "t1", "assistant", "answer one")],
      },
    },
  });
});

describe("Transcript", () => {
  it("renders user and assistant turns in order", () => {
    render(<Transcript sessionId={S} />);
    expect(screen.getByText("question one")).toBeInTheDocument();
    expect(screen.getByText("answer one")).toBeInTheDocument();
  });

  it("shows the working indicator while status is working", () => {
    useAgentStore.setState((s) => ({
      sessions: { ...s.sessions, [S]: { ...s.sessions[S], status: "working" } },
    }));
    render(<Transcript sessionId={S} />);
    expect(screen.getByTestId("agent-working")).toBeInTheDocument();
  });
});

describe("TurnFooter wiring", () => {
  it("renders the footer under a completed turn that has meta", () => {
    useAgentStore.setState({
      sessions: {
        [S]: {
          ...emptySession(),
          hydrated: true,
          messages: [m("u1", "t1", "user", "question one"), m("a1", "t1", "assistant", "answer one")],
          turnMeta: { t1: { usage: { inputTokens: 1, outputTokens: 1, durationMs: 1000 } } },
        },
      },
    });
    render(<Transcript sessionId={S} />);
    expect(screen.getByTestId("turn-footer-t1")).toBeInTheDocument();
  });

  it("does not render the footer for the streaming (last, in-progress) turn", () => {
    useAgentStore.setState({
      sessions: {
        [S]: {
          ...emptySession(),
          hydrated: true,
          status: "working",
          messages: [m("u1", "t1", "user", "question one"), m("a1", "t1", "assistant", "answer one")],
          turnMeta: { t1: { usage: { inputTokens: 1, outputTokens: 1, durationMs: 1000 } } },
        },
      },
    });
    render(<Transcript sessionId={S} />);
    expect(screen.queryByTestId("turn-footer-t1")).not.toBeInTheDocument();
  });
});

describe("Retry on error rows", () => {
  const userParts: AgentPart[] = [{ type: "text", text: "original prompt" }, { type: "attachment", name: "a.png", path: "/tmp/a.png", mime: "image/png" }];

  function withErrorTurn() {
    useAgentStore.setState({
      sessions: {
        [S]: {
          ...emptySession(),
          hydrated: true,
          messages: [
            m("u1", "t1", "user", "original prompt", userParts),
            m("e1", "error", "system", "agent run failed"),
          ],
        },
      },
    });
  }

  it("renders a Retry button on a turn with a user message and an error, and fires onRetry with the original parts", async () => {
    withErrorTurn();
    const onRetry = vi.fn();
    render(<Transcript sessionId={S} onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Retry message" }));
    expect(onRetry).toHaveBeenCalledWith({ userParts });
  });

  it("does not render Retry when the turn has no error", () => {
    useAgentStore.setState({
      sessions: {
        [S]: {
          ...emptySession(),
          hydrated: true,
          messages: [m("u1", "t1", "user", "question one"), m("a1", "t1", "assistant", "answer one")],
        },
      },
    });
    render(<Transcript sessionId={S} onRetry={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Retry message" })).not.toBeInTheDocument();
  });

  it("does not render Retry when onRetry is not provided", () => {
    withErrorTurn();
    render(<Transcript sessionId={S} />);
    expect(screen.queryByRole("button", { name: "Retry message" })).not.toBeInTheDocument();
  });
});
