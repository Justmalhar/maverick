import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.unmock("react-markdown");
vi.unmock("remark-gfm");

// Exercise the resolved-highlighter path (dangerouslySetInnerHTML branch) and
// its try/catch around codeToHtml, isolated from ChatMarkdown.test.tsx so the
// two files' shiki mocks (never-resolving vs. resolving) don't collide.
const codeToHtml = vi.fn((code: string) => `<span data-testid="highlighted">${code}</span>`);
vi.mock("shiki", () => ({
  createHighlighter: vi.fn(async () => ({ codeToHtml })),
}));

const { ChatMarkdown } = await import("./ChatMarkdown");

describe("ChatMarkdown CodeBlock highlighter", () => {
  it("swaps the plain <pre> fallback for shiki's highlighted markup once it resolves", async () => {
    render(<ChatMarkdown text={"```ts\nconst x = 1;\n```"} />);
    await waitFor(() =>
      expect(codeToHtml).toHaveBeenCalledWith("const x = 1;", { lang: "ts", theme: "github-dark-default" })
    );
    await waitFor(() => expect(screen.getByTestId("highlighted")).toBeInTheDocument());
  });

  it("falls back to an empty string when codeToHtml throws", async () => {
    codeToHtml.mockImplementationOnce(() => {
      throw new Error("unsupported lang");
    });
    const { container } = render(<ChatMarkdown text={"```weird\nfoo\n```"} />);
    await waitFor(() => expect(codeToHtml).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="highlighted"]')).not.toBeInTheDocument();
  });

  it("guards against a state update after unmount via the effect's cleanup flag", async () => {
    codeToHtml.mockClear();
    const { unmount } = render(<ChatMarkdown text={"```ts\nunmount-before-resolve\n```"} />);
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(codeToHtml).not.toHaveBeenCalledWith("unmount-before-resolve", expect.anything());
    cleanup();
  });
});
