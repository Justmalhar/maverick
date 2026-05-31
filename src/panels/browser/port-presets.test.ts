import { describe, it, expect, vi, afterEach } from "vitest";
import { PORT_PRESETS, isLocalUrl, normalizeUrl, probeUrl } from "./port-presets";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PORT_PRESETS", () => {
  it("contains curated dev-server ports with unique entries", () => {
    expect(PORT_PRESETS.length).toBeGreaterThan(10);
    const ports = PORT_PRESETS.map((p) => p.port);
    expect(new Set(ports).size).toBe(ports.length);
    expect(ports).toContain(3000);
    expect(ports).toContain(5173);
    expect(ports).toContain(11434);
  });
});

describe("isLocalUrl", () => {
  it.each([
    ["http://localhost:3000", true],
    ["http://127.0.0.1:8080", true],
    ["http://0.0.0.0:5000", true],
    ["http://[::1]:6006", true],
    ["http://app.localhost/x", true],
    ["https://example.com", false],
  ])("%s -> %s", (url, expected) => {
    expect(isLocalUrl(url)).toBe(expected);
  });

  it("returns false for unparseable input", () => {
    expect(isLocalUrl("not a url")).toBe(false);
  });
});

describe("normalizeUrl", () => {
  it.each([
    ["  ", null],
    ["https://x.com", "https://x.com"],
    ["http://x.com", "http://x.com"],
    ["localhost:3000", "http://localhost:3000"],
    ["127.0.0.1:8080", "http://127.0.0.1:8080"],
    ["example.com", "https://example.com"],
    ["search term", "search term"],
  ])("%s -> %s", (raw, expected) => {
    expect(normalizeUrl(raw)).toBe(expected);
  });
});

describe("probeUrl", () => {
  it("returns true when fetch settles", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(probeUrl("http://localhost:3000")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000",
      expect.objectContaining({ mode: "no-cors", cache: "no-store" })
    );
  });

  it("returns false when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(probeUrl("http://localhost:9999")).resolves.toBe(false);
  });
});
