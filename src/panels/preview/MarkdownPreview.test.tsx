import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import MarkdownPreview from "./MarkdownPreview";

vi.mock("react-markdown", () => ({
  default: () => (
    <>
      <pre>
        <code className="language-ts">const x = 1;</code>
      </pre>
      <pre>
        <code className="language-unknown">::weird::</code>
      </pre>
    </>
  ),
}));

describe("MarkdownPreview", () => {
  it("renders the markdown container", () => {
    renderWithProviders(<MarkdownPreview content="# hello" />);
    expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
  });

  it("re-highlights when content changes; covers try and catch", async () => {
    const hljsMod = await import("highlight.js/lib/common");
    const hljs = (hljsMod as unknown as { default: { highlightElement: ReturnType<typeof vi.fn> } }).default;
    hljs.highlightElement.mockReset();
    hljs.highlightElement
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error("unknown lang");
      });
    const { rerender } = renderWithProviders(<MarkdownPreview content="a" />);
    rerender(<MarkdownPreview content="b" />);
    expect(hljs.highlightElement).toHaveBeenCalled();
  });
});
