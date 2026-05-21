import { describe, it, expect, vi, beforeAll } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import PDFPreview from "./PDFPreview";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

describe("PDFPreview", () => {
  it("returns early when canvas getContext is null", async () => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    renderWithProviders(<PDFPreview filePath="/null.pdf" />);
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
    HTMLCanvasElement.prototype.getContext = original;
  });

  it("surfaces render errors", async () => {
    const pdfjs = await import("pdfjs-dist");
    const failDoc = {
      numPages: 1,
      getPage: vi.fn().mockRejectedValue(new Error("render-fail")),
      destroy: vi.fn(),
    };
    vi.mocked(pdfjs.getDocument).mockReturnValueOnce({
      promise: Promise.resolve(failDoc),
    } as unknown as ReturnType<typeof pdfjs.getDocument>);
    renderWithProviders(<PDFPreview filePath="/fail.pdf" />);
    await waitFor(() => expect(screen.getByText(/render-fail/)).toBeInTheDocument());
  });

  it("loads the document, paginates, and zooms", async () => {
    renderWithProviders(<PDFPreview filePath="/a.pdf" />);
    await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("pdf-next"));
    await userEvent.click(screen.getByTestId("pdf-prev"));
    await userEvent.click(screen.getByTestId("pdf-zoom-in"));
    await userEvent.click(screen.getByTestId("pdf-zoom-out"));
  });

  it("renders an error when getDocument rejects", async () => {
    const pdfjs = await import("pdfjs-dist");
    vi.mocked(pdfjs.getDocument).mockReturnValueOnce({
      promise: Promise.reject(new Error("bad pdf")),
    } as unknown as ReturnType<typeof pdfjs.getDocument>);
    renderWithProviders(<PDFPreview filePath="/b.pdf" />);
    await waitFor(() => expect(screen.getByText(/bad pdf/)).toBeInTheDocument());
  });

  it("cancels load when filePath changes", async () => {
    const pdfjs = await import("pdfjs-dist");
    const destroy = vi.fn();
    vi.mocked(pdfjs.getDocument).mockReturnValueOnce({
      promise: Promise.resolve({ numPages: 1, getPage: () => Promise.resolve({
        getViewport: () => ({ width: 10, height: 10 }),
        render: () => ({ promise: Promise.resolve() }),
      }), destroy }),
    } as unknown as ReturnType<typeof pdfjs.getDocument>);
    const { rerender } = renderWithProviders(<PDFPreview filePath="/c.pdf" />);
    rerender(<PDFPreview filePath="/d.pdf" />);
  });
});
