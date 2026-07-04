import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AssistantTurn } from "./AssistantTurn";
import type { AgentChatMessage } from "@/lib/ipc";

describe("AssistantTurn", () => {
  it("shows the final answer while collapsing prior tool-call activity", () => {
    const messages: AgentChatMessage[] = [
      {
        id: "a1",
        sessionId: "s",
        turnId: "t1",
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            toolUseId: "t1",
            toolName: "Bash",
            title: "Run tests",
            status: "ok",
          },
        ],
        createdAt: 1,
      },
      {
        id: "a2",
        sessionId: "s",
        turnId: "t1",
        role: "assistant",
        parts: [{ type: "text", text: "All tests pass." }],
        createdAt: 2,
      },
    ];
    render(<AssistantTurn messages={messages} streaming={false} />);
    expect(screen.getByTestId("assistant-turn")).toBeInTheDocument();
    expect(screen.getByText("All tests pass.")).toBeInTheDocument();
    expect(screen.queryByText("Run tests")).not.toBeInTheDocument();
    expect(screen.getByTestId("activity-toggle")).toHaveTextContent("1 tool call, 0 messages");
  });

  it("treats a streaming turn as having no final answer yet", () => {
    const messages: AgentChatMessage[] = [
      { id: "a1", sessionId: "s", turnId: "t1", role: "assistant", parts: [{ type: "text", text: "partial" }], createdAt: 1 },
    ];
    render(<AssistantTurn messages={messages} streaming />);
    expect(screen.queryByTestId("activity-toggle")).not.toBeInTheDocument();
    expect(screen.getByText("partial")).toBeInTheDocument();
  });

  it("renders nothing extra for an empty message list", () => {
    render(<AssistantTurn messages={[]} streaming={false} />);
    expect(screen.getByTestId("assistant-turn")).toBeEmptyDOMElement();
  });

  it("skips non-text parts of the final answer message", () => {
    const messages: AgentChatMessage[] = [
      {
        id: "a1",
        sessionId: "s",
        turnId: "t1",
        role: "assistant",
        parts: [{ type: "thinking", summary: "wrapping up" }, { type: "text", text: "Done." }],
        createdAt: 1,
      },
    ];
    render(<AssistantTurn messages={messages} streaming={false} />);
    expect(screen.getByText("Done.")).toBeInTheDocument();
    expect(screen.queryByText("wrapping up")).not.toBeInTheDocument();
  });
});
