import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/tauri", () => ({ ptyKill: vi.fn(() => Promise.resolve()) }));
import { ptyKill } from "@/lib/tauri";
import { killTerminalGroupLeaves, __testing__ } from "./leaf-registry";

beforeEach(() => {
  __testing__.leafPtyCache.clear();
  vi.mocked(ptyKill).mockClear();
});

it("kills only the target group's leaves", () => {
  __testing__.leafPtyCache.set("term-abc-1", "pty1");
  __testing__.leafPtyCache.set("term-abc-2", "pty2");
  __testing__.leafPtyCache.set("w1-1", "pty3");
  killTerminalGroupLeaves("term-abc");
  expect(ptyKill).toHaveBeenCalledTimes(2);
  expect(__testing__.leafPtyCache.has("term-abc-1")).toBe(false);
  expect(__testing__.leafPtyCache.has("w1-1")).toBe(true);
});
