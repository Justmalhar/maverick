import { describe, it, expect } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import FilePreviewPanel from "./FilePreviewPanel";

describe("FilePreviewPanel", () => {
  it.each([
    ["a.md", "", "markdown-preview"],
    ["a.markdown", "", "markdown-preview"],
    ["a.pdf", "", "pdf-preview"],
    ["a.png", "", "image-preview"],
    ["a.mp4", "", "video-preview"],
    ["a.unknown", "", "raw-preview"],
    ["a", "text/markdown", "markdown-preview"],
    ["a", "application/pdf", "pdf-preview"],
    ["a", "image/png", "image-preview"],
    ["a", "video/mp4", "video-preview"],
  ])("dispatches %s + %s to %s", (path, mime, tid) => {
    renderWithProviders(<FilePreviewPanel filePath={path} mimeType={mime} content="x" />);
    expect(screen.getByTestId(tid)).toBeInTheDocument();
  });

  it("works with no extension", () => {
    renderWithProviders(<FilePreviewPanel filePath="noext" content="text" />);
    expect(screen.getByTestId("raw-preview")).toBeInTheDocument();
  });

  it("renders markdown as raw when raw flag is set (by extension)", () => {
    renderWithProviders(<FilePreviewPanel filePath="a.md" content="# x" raw />);
    expect(screen.getByTestId("raw-preview")).toBeInTheDocument();
  });

  it("renders markdown as raw when raw flag is set (by mime)", () => {
    renderWithProviders(
      <FilePreviewPanel filePath="a" mimeType="text/markdown" content="# x" raw />
    );
    expect(screen.getByTestId("raw-preview")).toBeInTheDocument();
  });
});
