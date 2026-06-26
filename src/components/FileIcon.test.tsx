import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { FileIcon } from "./FileIcon";

function imgOf(container: HTMLElement): HTMLImageElement {
  const img = container.querySelector("img");
  if (!img) throw new Error("expected an <img>");
  return img as HTMLImageElement;
}

describe("FileIcon", () => {
  it("renders the file-type icon for a file", () => {
    const { container } = render(<FileIcon name="app.tsx" />);
    expect(imgOf(container).getAttribute("src")).toContain("react_ts.svg");
  });

  it("renders the collapsed folder icon by default for a directory", () => {
    const { container } = render(<FileIcon name="src" isDirectory />);
    expect(imgOf(container).getAttribute("src")).toContain("folder-src.svg");
  });

  it("renders the open folder icon when an expanded directory", () => {
    const { container } = render(<FileIcon name="src" isDirectory expanded />);
    expect(imgOf(container).getAttribute("src")).toContain("folder-src-open.svg");
  });

  it("is decorative and merges extra classes", () => {
    const { container } = render(<FileIcon name="a.ts" className="mr-2" />);
    const img = imgOf(container);
    expect(img.getAttribute("alt")).toBe("");
    expect(img.className).toContain("mr-2");
    expect(img.className).toContain("shrink-0");
  });
});
