import { describe, expect, it } from "vitest";
import { viewerRegistry } from "@/lib/viewers";
import { fileMetaForPath } from "@/lib/viewers/types";

describe("builtin viewer registration", () => {
  it.each([
    ["/wt/readme.md", "preview", "markdown"],
    ["/wt/logo.png", "preview", "image"],
    ["/wt/demo.mp4", "preview", "video"],
    ["/wt/doc.pdf", "preview", "pdf"],
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
});
