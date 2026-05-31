import { describe, it, expect } from "vitest";
import { DormantRing } from "./dormant-ring";

const NOTICE = "\x1bc\x1b[2m[maverick: dropped output during hibernation]\x1b[0m\r\n";

function drainToArray(ring: DormantRing): string[] {
  const out: string[] = [];
  ring.drain((d) => out.push(d));
  return out;
}

describe("DormantRing", () => {
  it("ignores empty pushes", () => {
    const ring = new DormantRing();
    ring.push("");
    expect(ring.byteLength()).toBe(0);
    expect(drainToArray(ring)).toEqual([]);
  });

  it("buffers chunks and drains them in order with no overflow notice", () => {
    const ring = new DormantRing();
    ring.push("a");
    ring.push("b");
    ring.push("c");
    expect(ring.didOverflow).toBe(false);
    expect(drainToArray(ring)).toEqual(["a", "b", "c"]);
    // Draining resets the ring.
    expect(ring.byteLength()).toBe(0);
    expect(drainToArray(ring)).toEqual([]);
  });

  it("tracks byte length using UTF-8 encoded size", () => {
    const ring = new DormantRing();
    ring.push("é"); // 2 bytes in UTF-8
    expect(ring.byteLength()).toBe(2);
  });

  it("drops oldest chunks past the byte cap and prepends the overflow notice", () => {
    // Tiny byte cap forces eviction after a couple of pushes.
    const ring = new DormantRing(8, 256);
    ring.push("aaaa"); // 4 bytes
    ring.push("bbbb"); // 8 bytes total — at cap, kept
    ring.push("cccc"); // overflow → drop "aaaa"
    expect(ring.didOverflow).toBe(true);
    const out = drainToArray(ring);
    expect(out[0]).toBe(NOTICE);
    expect(out).not.toContain("aaaa");
    expect(out).toContain("cccc");
  });

  it("drops oldest chunks past the chunk cap", () => {
    const ring = new DormantRing(1024 * 1024, 2);
    ring.push("1");
    ring.push("2");
    ring.push("3"); // size would be 3 > 2 → drop "1"
    expect(ring.didOverflow).toBe(true);
    const out = drainToArray(ring);
    expect(out[0]).toBe(NOTICE);
    expect(out).not.toContain("1");
    expect(out).toContain("2");
    expect(out).toContain("3");
  });

  it("a single oversized write keeps only its tail and resets the ring", () => {
    const ring = new DormantRing(8, 256);
    ring.push("xxxx");
    const huge = "0123456789ABCDEF"; // 16 bytes >= cap of 8
    ring.push(huge);
    expect(ring.didOverflow).toBe(true);
    const out = drainToArray(ring);
    // The notice IS the first chunk, so drain does not double-prepend it.
    expect(out[0]).toBe(NOTICE);
    expect(out).toHaveLength(2);
    // Only the last byteCap chars are retained.
    expect(out[1]).toBe(huge.slice(-8));
    expect(out).not.toContain("xxxx");
  });

  it("does not double-prepend the notice when the first surviving chunk is the notice", () => {
    const ring = new DormantRing(8, 256);
    ring.push("0123456789"); // oversized → chunks become [NOTICE, tail]
    const out = drainToArray(ring);
    // Exactly one notice.
    expect(out.filter((c) => c === NOTICE)).toHaveLength(1);
  });

  it("compacts the backing array when the dead prefix dominates", () => {
    // chunkCap large enough that we never overflow; push many 1-byte chunks so
    // head advances past the compaction threshold (1024) without dropping.
    const ring = new DormantRing(1024 * 1024, 2);
    for (let i = 0; i < 3000; i++) ring.push("x");
    // With chunkCap=2 the head keeps advancing; the compaction branch runs.
    // Draining still yields the two surviving chunks plus a notice.
    const out = drainToArray(ring);
    expect(out[0]).toBe(NOTICE);
    expect(out.slice(1)).toEqual(["x", "x"]);
  });

  it("clear() empties the ring without emitting a notice", () => {
    const ring = new DormantRing(8, 256);
    ring.push("aaaa");
    ring.push("bbbb");
    ring.push("cccc"); // triggers overflow
    ring.clear();
    expect(ring.byteLength()).toBe(0);
    expect(ring.didOverflow).toBe(false);
    expect(drainToArray(ring)).toEqual([]);
  });
});
