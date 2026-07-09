import type { AgentPart } from "@/lib/ipc";

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json",
};

export function attachmentForPath(path: string): Extract<AgentPart, { type: "attachment" }> {
  const name = path.split(/[/\\]/).pop() ?? path;
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return { type: "attachment", name, path, mime: MIME_BY_EXT[ext] ?? "application/octet-stream" };
}
