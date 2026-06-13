import { describe, it, expect } from "vitest";
import { joinPath } from "./paths";

describe("joinPath", () => {
  it("joins root and rel with a single slash", () => {
    expect(joinPath("/home/user/project", "src/index.ts")).toBe("/home/user/project/src/index.ts");
  });

  it("strips trailing slash from root to avoid double slash", () => {
    expect(joinPath("/home/user/project/", "src/index.ts")).toBe("/home/user/project/src/index.ts");
  });

  it("handles filesystem root ('/') without producing '//rel'", () => {
    expect(joinPath("/", "etc/hosts")).toBe("/etc/hosts");
  });

  it("handles rel with no nested path (filename only)", () => {
    expect(joinPath("/home/user/project", "README.md")).toBe("/home/user/project/README.md");
  });

  it("handles rel with leading ./ (passes through unchanged)", () => {
    // Sidecar does not emit ./ prefix; this is defensive only.
    expect(joinPath("/home/user/project", "./src/index.ts")).toBe("/home/user/project/./src/index.ts");
  });
});
