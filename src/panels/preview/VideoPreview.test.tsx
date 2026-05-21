import { describe, it, expect } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import VideoPreview from "./VideoPreview";

describe("VideoPreview", () => {
  it("renders a controlled video element", () => {
    renderWithProviders(<VideoPreview filePath="/a.mp4" />);
    expect(screen.getByTestId("video-preview-el")).toHaveAttribute("src", "/a.mp4");
  });
});
