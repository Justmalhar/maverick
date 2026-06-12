// Self-registration barrel: importing this module populates viewerRegistry.
// FileTabPane is the only consumer. Each viewer task appends its register() call.
import { viewerRegistry } from "./registry";

export { viewerRegistry };

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v"]);

viewerRegistry.register({
  id: "markdown",
  displayName: "Markdown Preview",
  priority: 50,
  capabilities: { edit: true },
  canHandle: (f, intent) =>
    !f.binary && (f.ext === "md" || f.ext === "markdown" || f.ext === "mdx") && intent !== "diff",
  load: async () => (await import("@/components/viewers/MarkdownViewer")).default,
});

viewerRegistry.register({
  id: "image",
  displayName: "Image Viewer",
  priority: 50,
  capabilities: {},
  canHandle: (f, intent) => IMAGE_EXT.has(f.ext) && intent !== "diff",
  load: async () => (await import("@/components/viewers/MediaViewers")).ImageViewer,
});

viewerRegistry.register({
  id: "video",
  displayName: "Video Player",
  priority: 50,
  capabilities: {},
  canHandle: (f, intent) => VIDEO_EXT.has(f.ext) && intent !== "diff",
  load: async () => (await import("@/components/viewers/MediaViewers")).VideoViewer,
});

viewerRegistry.register({
  id: "pdf",
  displayName: "PDF Viewer",
  priority: 50,
  capabilities: {},
  canHandle: (f, intent) => f.ext === "pdf" && intent !== "diff",
  load: async () => (await import("@/components/viewers/PdfViewer")).default,
});

viewerRegistry.register({
  id: "hex",
  displayName: "Hex / Raw",
  priority: -10, // catch-all floor: wins only when nothing else matches
  capabilities: {},
  canHandle: () => true,
  load: async () => (await import("@/components/viewers/HexViewer")).default,
});
