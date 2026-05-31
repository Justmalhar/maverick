import { describe, test, expect } from "bun:test";
import { LogRing } from "./log-ring";

describe("LogRing", () => {
  test("returns all bytes when within cap", () => {
    const ring = new LogRing(64);
    ring.push("hello world");
    const page = ring.readFrom(0);
    expect(page.data).toBe("hello world");
    expect(page.nextOffset).toBe(11);
    expect(page.dropped).toBe(0);
  });

  test("skips the consumed prefix on paged reads", () => {
    const ring = new LogRing(64);
    ring.push("hello world");
    const page = ring.readFrom(6);
    expect(page.data).toBe("world");
    expect(page.nextOffset).toBe(11);
  });

  test("drops oldest bytes when overflowing the cap", () => {
    const ring = new LogRing(8);
    ring.push("abcdefgh");
    ring.push("ijkl");
    const page = ring.readFrom(0);
    expect(page.data).toBe("efghijkl");
    expect(page.nextOffset).toBe(12);
    expect(page.dropped).toBe(4);
  });

  test("clamps a since-offset older than the resident window", () => {
    const ring = new LogRing(8);
    ring.push("abcdefgh");
    ring.push("ijkl");
    const page = ring.readFrom(99);
    expect(page.data).toBe("");
    expect(page.nextOffset).toBe(12);
  });

  test("a single chunk larger than cap keeps only its tail", () => {
    const ring = new LogRing(4);
    ring.push("abcdefgh");
    const page = ring.readFrom(0);
    expect(page.data).toBe("efgh");
    expect(page.nextOffset).toBe(8);
    expect(page.dropped).toBe(4);
  });

  test("a single oversized chunk after existing data counts prior bytes as dropped", () => {
    const ring = new LogRing(4);
    ring.push("ab");
    ring.push("cdefgh");
    const page = ring.readFrom(0);
    expect(page.data).toBe("efgh");
    expect(page.dropped).toBe(4);
  });

  test("non-positive cap floors to one byte", () => {
    const ring = new LogRing(0);
    ring.push("xyz");
    const page = ring.readFrom(0);
    expect(page.data).toBe("z");
    expect(page.nextOffset).toBe(3);
  });

  test("defaults to a 256 KiB cap", () => {
    const ring = new LogRing();
    ring.push("a".repeat(1000));
    expect(ring.readFrom(0).data.length).toBe(1000);
  });
});
