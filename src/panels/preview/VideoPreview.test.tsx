import { describe, it, expect } from "vitest";
import { renderWithProviders, screen } from "@/test/utils";
import VideoPreview from "./VideoPreview";

describe("VideoPreview", () => {
  it("renders a controlled video element using the asset-converted src", () => {
    renderWithProviders(<VideoPreview filePath="/a.mp4" />);
    // convertFileSrc (mocked as asset://<path>) — a raw OS path won't load in the WebView.
    expect(screen.getByTestId("video-preview-el")).toHaveAttribute("src", "asset:///a.mp4");
  });
});
