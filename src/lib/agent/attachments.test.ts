import { describe, it, expect } from "vitest";
import { attachmentForPath } from "./attachments";

describe("attachmentForPath", () => {
  it("derives name and mime from a known extension", () => {
    expect(attachmentForPath("/tmp/Screenshot 2026-07-02.png")).toEqual({
      type: "attachment",
      name: "Screenshot 2026-07-02.png",
      path: "/tmp/Screenshot 2026-07-02.png",
      mime: "image/png",
    });
  });

  it("handles Windows-style path separators", () => {
    expect(attachmentForPath("C:\\Users\\mal\\notes.md")).toEqual({
      type: "attachment",
      name: "notes.md",
      path: "C:\\Users\\mal\\notes.md",
      mime: "text/markdown",
    });
  });

  it("falls back to application/octet-stream for unknown or missing extensions", () => {
    expect(attachmentForPath("/tmp/README")).toEqual({
      type: "attachment",
      name: "README",
      path: "/tmp/README",
      mime: "application/octet-stream",
    });
    expect(attachmentForPath("/tmp/archive.tar.gz")).toEqual({
      type: "attachment",
      name: "archive.tar.gz",
      path: "/tmp/archive.tar.gz",
      mime: "application/octet-stream",
    });
  });
});
