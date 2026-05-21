import { describe, it, expect } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, fireEvent } from "@/test/utils";
import ImagePreview from "./ImagePreview";

describe("ImagePreview", () => {
  it("renders, zooms via wheel, drags via mouse, resets via fit", async () => {
    renderWithProviders(<ImagePreview filePath="/a.png" />);
    const img = screen.getByTestId("image-preview-img");
    expect(img).toBeInTheDocument();
    const wheelTarget = img.parentElement!;
    fireEvent.wheel(wheelTarget, { deltaY: -100 });
    fireEvent.wheel(wheelTarget, { deltaY: 100 });
    fireEvent.mouseDown(wheelTarget, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(wheelTarget, { clientX: 30, clientY: 40 });
    fireEvent.mouseUp(wheelTarget);
    fireEvent.mouseDown(wheelTarget, { clientX: 10, clientY: 10 });
    fireEvent.mouseLeave(wheelTarget);
    await userEvent.click(screen.getByTestId("image-fit"));
  });

  it("mouseMove without prior mouseDown is a no-op", () => {
    renderWithProviders(<ImagePreview filePath="/a.png" />);
    const wheelTarget = screen.getByTestId("image-preview-img").parentElement!;
    fireEvent.mouseMove(wheelTarget);
  });
});
