import { describe, it, expect } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "@/test/utils";
import RawPreview from "./RawPreview";

describe("RawPreview", () => {
  it("renders text mode by default and switches to hex", async () => {
    renderWithProviders(<RawPreview filePath="/a" content="abcdefghijklmnop\x01" />);
    expect(screen.getByText(/abcdef/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("raw-hex"));
    expect(screen.getByText(/00000000/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("raw-text"));
  });

  it("handles missing content as empty string", () => {
    renderWithProviders(<RawPreview filePath="/x" />);
    expect(screen.getByTestId("raw-preview")).toBeInTheDocument();
  });
});
