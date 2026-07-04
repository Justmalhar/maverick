import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { ActivitySection } from "./ActivitySection";
import type { AgentChatMessage } from "@/lib/ipc";

const msg = (id: string, parts: AgentChatMessage["parts"]): AgentChatMessage => ({
  id, sessionId: "s", turnId: "t", role: "assistant", parts, createdAt: 1,
});
const toolPart = {
  type: "tool-call" as const,
  toolUseId: "t1",
  toolName: "Bash",
  title: "List files",
  detail: "ls",
  status: "ok" as const,
  output: "a\nb",
};

describe("ActivitySection", () => {
  it("collapses completed activity behind a count summary and expands on click", async () => {
    render(<ActivitySection streaming={false} messages={[msg("m1", [toolPart, { type: "text", text: "interim" }])]} />);
    expect(screen.getByTestId("activity-toggle")).toHaveTextContent("1 tool call, 1 message");
    expect(screen.queryByText("List files")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("activity-toggle"));
    expect(screen.getByText("List files")).toBeInTheDocument();
  });

  it("streams expanded without a toggle", () => {
    render(<ActivitySection streaming messages={[msg("m1", [{ ...toolPart, status: "running" }])]} />);
    expect(screen.queryByTestId("activity-toggle")).not.toBeInTheDocument();
    expect(screen.getByText("List files")).toBeInTheDocument();
  });

  it("renders thinking parts and skips attachment parts", () => {
    render(
      <ActivitySection
        streaming
        messages={[
          msg("m1", [
            { type: "thinking", summary: "mulling it over" },
            { type: "attachment", name: "a.png", path: "/a.png", mime: "image/png" },
          ]),
        ]}
      />
    );
    expect(screen.getByText("mulling it over")).toBeInTheDocument();
    expect(screen.queryByText("a.png")).not.toBeInTheDocument();
  });

  it("returns nothing for an empty message list", () => {
    const { container } = render(<ActivitySection streaming={false} messages={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("pluralizes multiple tool calls and skips blank text parts once expanded", async () => {
    render(
      <ActivitySection
        streaming={false}
        messages={[msg("m1", [toolPart, { ...toolPart, toolUseId: "t2" }, { type: "text", text: "   " }])]}
      />
    );
    expect(screen.getByTestId("activity-toggle")).toHaveTextContent("2 tool calls, 0 messages");
    await userEvent.click(screen.getByTestId("activity-toggle"));
    expect(screen.getAllByText("List files")).toHaveLength(2);
  });
});
