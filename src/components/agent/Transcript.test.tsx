import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { Transcript } from "./Transcript";
import { useAgentStore, emptySession } from "@/state/agent-store";
import type { AgentChatMessage } from "@/lib/ipc";

const S = "sess1";
const m = (id: string, turnId: string, role: AgentChatMessage["role"], text: string): AgentChatMessage => ({
  id, turnId, role, sessionId: S, parts: [{ type: "text", text }], createdAt: 1,
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
