import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.unmock("react-markdown");
vi.unmock("remark-gfm");

// Prevent the async shiki highlighter from ever resolving during this test
// file's run — CodeBlock only needs to prove its plain <pre> fallback
// renders; letting the real (or setup-mocked) shiki module settle mid-test
// would trigger act() warnings from the state update racing test teardown.
vi.mock("shiki", () => ({
  createHighlighter: vi.fn(() => new Promise(() => {})),
}));

const { ChatMarkdown } = await import("./ChatMarkdown");

describe("ChatMarkdown", () => {
  it("renders gfm tables inside a horizontal-scroll container", () => {
    render(<ChatMarkdown text={"| a | b |\n| - | - |\n| 1 | 2 |"} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
  it("renders inline code and fenced code", () => {
    render(<ChatMarkdown text={"use `bun` here\n\n```ts\nconst x = 1;\n```"} />);
    expect(screen.getByText("bun")).toBeInTheDocument();
    expect(screen.getByText(/const x = 1/)).toBeInTheDocument();
  });
  it("falls back to the 'text' language for a fenced block with none declared", () => {
    render(<ChatMarkdown text={"```\nline one\nline two\n```"} />);
    expect(screen.getByText(/line one/)).toBeInTheDocument();
  });
  it("opens links in a new tab", () => {
    render(<ChatMarkdown text={"[docs](https://example.com)"} />);
    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("href", "https://example.com");
  });
});
