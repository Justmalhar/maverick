import { describe, it, expect } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import { MessageList } from "./MessageList";
import { makeMessage } from "@/test/fixtures";

describe("MessageList", () => {
  it("renders empty state", () => {
    renderWithProviders(<MessageList messages={[]} />);
    expect(screen.getByText("Send a prompt to start the conversation")).toBeInTheDocument();
  });

  it("renders user + agent messages", () => {
    renderWithProviders(
      <MessageList
        messages={[
          makeMessage({ id: "u1", role: "user", content: "hello" }),
          makeMessage({ id: "a1", role: "assistant", content: "world" }),
        ]}
      />
    );
    expect(screen.getByTestId("message-user-u1")).toBeInTheDocument();
    expect(screen.getByTestId("message-agent-a1")).toBeInTheDocument();
  });
});
