import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { UserMessage } from "./UserMessage";
import type { AgentChatMessage } from "@/lib/ipc";

describe("UserMessage", () => {
  it("right-aligns the bubble and renders text + attachment chips", () => {
    const message: AgentChatMessage = {
      id: "u1",
      sessionId: "s",
      turnId: "t1",
      role: "user",
      parts: [
        { type: "text", text: "please fix this" },
        { type: "attachment", name: "screenshot.png", path: "/tmp/screenshot.png", mime: "image/png" },
      ],
      createdAt: 1,
    };
    render(<UserMessage message={message} />);
    const bubble = screen.getByTestId("user-message-u1");
    expect(bubble).toHaveClass("justify-end");
    expect(screen.getByText("please fix this")).toBeInTheDocument();
    expect(screen.getByText("screenshot.png")).toBeInTheDocument();
  });
});
