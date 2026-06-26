import { describe, it, expect } from "vitest";
import { iconUrl, fileIconUrl, folderIconUrl } from "./file-icons";

describe("iconUrl", () => {
  it("resolves a known icon name to its asset url", () => {
    expect(iconUrl("typescript")).toContain("typescript.svg");
  });

  it("falls back to the generic file icon for an unknown name", () => {
    expect(iconUrl("__definitely-not-an-icon__")).toContain("file.svg");
  });
});

describe("fileIconUrl", () => {
  it("maps a known extension to its language icon", () => {
    expect(fileIconUrl("app.tsx")).toContain("react_ts.svg");
  });

  it("maps a special filename to its icon", () => {
    expect(fileIconUrl("package.json")).toContain("nodejs.svg");
  });

  it("falls back to the generic file icon for an unknown extension", () => {
    expect(fileIconUrl("mystery.zzz")).toContain("file.svg");
  });
});

describe("folderIconUrl", () => {
  it("resolves a named folder when collapsed", () => {
    expect(folderIconUrl("src", false)).toContain("folder-src.svg");
  });

  it("resolves the open variant when expanded", () => {
    expect(folderIconUrl("src", true)).toContain("folder-src-open.svg");
  });

  it("falls back to the generic folder for an unknown name", () => {
    expect(folderIconUrl("whatever-unknown", false)).toContain("folder.svg");
  });
});
