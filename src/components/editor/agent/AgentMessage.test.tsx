import { describe, it, expect } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import { AgentMessage } from "./AgentMessage";
import { makeMessage } from "@/test/fixtures";

describe("AgentMessage", () => {
  it("renders agent message content", () => {
    renderWithProviders(<AgentMessage message={makeMessage({ id: "m1", role: "assistant", content: "Hello" })} />);
    expect(screen.getByTestId("message-agent-m1")).toHaveTextContent("Hello");
  });

  it("parses tool calls JSON safely and shows summary", () => {
    renderWithProviders(
      <AgentMessage
        message={makeMessage({
          id: "m2", role: "assistant", content: "x",
          toolCallsJson: JSON.stringify([{ name: "read" }]),
        })}
      />
    );
    expect(screen.getByTestId("tool-call-summary")).toBeInTheDocument();
  });

  it("ignores invalid JSON and non-array payloads", () => {
    renderWithProviders(
      <AgentMessage
        message={makeMessage({ id: "m3", role: "assistant", content: "x", toolCallsJson: "not json" })}
      />
    );
    expect(screen.queryByTestId("tool-call-summary")).not.toBeInTheDocument();

    renderWithProviders(
      <AgentMessage
        message={makeMessage({ id: "m4", role: "assistant", content: "x", toolCallsJson: JSON.stringify({ a: 1 }) })}
      />
    );
    expect(screen.queryByTestId("tool-call-summary")).not.toBeInTheDocument();
  });
});
