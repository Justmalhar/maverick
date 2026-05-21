import { describe, it, expect } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import { UserMessage } from "./UserMessage";
import { makeMessage } from "@/test/fixtures";

describe("UserMessage", () => {
  it("renders the message content", () => {
    renderWithProviders(<UserMessage message={makeMessage({ id: "m1", content: "hi there" })} />);
    expect(screen.getByTestId("message-user-m1")).toHaveTextContent("hi there");
  });
});
