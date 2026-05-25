import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { open } from "@tauri-apps/plugin-dialog";
import { pickProjectFolder } from "./dialog";

beforeEach(() => {
  vi.mocked(open).mockReset();
});

describe("pickProjectFolder", () => {
  it("returns the picked path when open returns a string", async () => {
    vi.mocked(open).mockResolvedValueOnce("/users/me/projects/foo" as never);
    const result = await pickProjectFolder();
    expect(result).toBe("/users/me/projects/foo");
  });

  it("returns null when open returns null (no selection)", async () => {
    vi.mocked(open).mockResolvedValueOnce(null as never);
    const result = await pickProjectFolder();
    expect(result).toBeNull();
  });

  it("falls back to window.prompt when plugin throws", async () => {
    vi.mocked(open).mockRejectedValueOnce(new Error("plugin unavailable"));
    vi.spyOn(window, "prompt").mockReturnValueOnce("/fallback/path");
    const result = await pickProjectFolder();
    expect(result).toBe("/fallback/path");
    vi.restoreAllMocks();
  });

  it("returns null when prompt is cancelled (returns null)", async () => {
    vi.mocked(open).mockRejectedValueOnce(new Error("plugin unavailable"));
    vi.spyOn(window, "prompt").mockReturnValueOnce(null);
    const result = await pickProjectFolder();
    expect(result).toBeNull();
    vi.restoreAllMocks();
  });
});
