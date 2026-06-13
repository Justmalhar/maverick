import { describe, expect, it } from "vitest";
import { viewerRegistry } from "@/lib/viewers";
import { fileMetaForPath } from "@/lib/viewers/types";

describe("builtin viewer registration", () => {
  it.each([
    ["/wt/readme.md", "preview", "markdown"],
    ["/wt/logo.png", "preview", "image"],
    ["/wt/demo.mp4", "preview", "video"],
    ["/wt/doc.pdf", "preview", "pdf"],
    ["/wt/data.csv", "preview", "grid"],
  ])("%s + %s resolves to %s", (path, intent, expected) => {
    const winner = viewerRegistry.resolve(fileMetaForPath(path), intent as never)[0];
    expect(winner?.id).toBe(expected);
  });

  it("binary files fall back to hex", () => {
    const meta = fileMetaForPath("/wt/blob.bin", { binary: true });
    expect(viewerRegistry.resolve(meta, "preview")[0]?.id).toBe("hex");
  });

  it("markdown supports edit intent (View/Edit toggle)", () => {
    const meta = fileMetaForPath("/wt/readme.md");
    const ids = viewerRegistry.resolve(meta, "edit").map((d) => d.id);
    expect(ids).toContain("markdown");
  });

  it("non-binary text files resolve to code editor for edit intent", () => {
    const meta = fileMetaForPath("/wt/src/main.rs");
    expect(viewerRegistry.resolve(meta, "edit")[0]?.id).toBe("code");
  });

  it("diff intent resolves to diff viewer for non-binary files", () => {
    const meta = fileMetaForPath("/wt/src/main.rs");
    expect(viewerRegistry.resolve(meta, "diff")[0]?.id).toBe("diff");
  });

  it("diff intent does not resolve to code or markdown (binary=false still excluded)", () => {
    const meta = fileMetaForPath("/wt/src/main.rs");
    const ids = viewerRegistry.resolve(meta, "diff").map((d) => d.id);
    expect(ids).not.toContain("code");
    expect(ids).not.toContain("markdown");
  });

  it("diff intent on binary file only matches hex (catch-all)", () => {
    const meta = fileMetaForPath("/wt/blob.bin", { binary: true });
    const ids = viewerRegistry.resolve(meta, "diff").map((d) => d.id);
    // diff viewer excludes binary; code excludes diff intent; hex is catch-all
    expect(ids).not.toContain("diff");
    expect(ids).not.toContain("code");
    expect(ids).toContain("hex");
  });
});

describe("builtin viewer load() functions", () => {
  it("markdown load() returns a component", async () => {
    const descriptor = viewerRegistry.get("markdown");
    expect(descriptor).toBeDefined();
    const Component = await descriptor!.load();
    expect(typeof Component).toBe("function");
  });

  it("image load() returns a component", async () => {
    const descriptor = viewerRegistry.get("image");
    expect(descriptor).toBeDefined();
    const Component = await descriptor!.load();
    expect(typeof Component).toBe("function");
  });

  it("video load() returns a component", async () => {
    const descriptor = viewerRegistry.get("video");
    expect(descriptor).toBeDefined();
    const Component = await descriptor!.load();
    expect(typeof Component).toBe("function");
  });

  it("pdf load() returns a component", async () => {
    const descriptor = viewerRegistry.get("pdf");
    expect(descriptor).toBeDefined();
    const Component = await descriptor!.load();
    expect(typeof Component).toBe("function");
  });

  it("hex load() returns a component", async () => {
    const descriptor = viewerRegistry.get("hex");
    expect(descriptor).toBeDefined();
    const Component = await descriptor!.load();
    expect(typeof Component).toBe("function");
  });

  it("code load() returns a component", async () => {
    const descriptor = viewerRegistry.get("code");
    expect(descriptor).toBeDefined();
    const Component = await descriptor!.load();
    expect(typeof Component).toBe("function");
  });

  it("diff load() returns a component", async () => {
    const descriptor = viewerRegistry.get("diff");
    expect(descriptor).toBeDefined();
    const Component = await descriptor!.load();
    expect(typeof Component).toBe("function");
  });

  it("grid load() returns a component", async () => {
    const descriptor = viewerRegistry.get("grid");
    expect(descriptor).toBeDefined();
    const Component = await descriptor!.load();
    expect(typeof Component).toBe("function");
  });
});
