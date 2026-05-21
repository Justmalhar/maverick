import { describe, it, expect } from "vitest";
import { GhosttyProvider } from "./ghostty-provider";
import type { TerminalTheme } from "../ipc";

describe("GhosttyProvider", () => {
  it("throws because it is not implemented until v0.2", () => {
    const provider = new GhosttyProvider();
    const opts = {
      theme: {} as TerminalTheme,
      fontSize: 12, fontFamily: "mono", ligatures: false, scrollback: 0,
    };
    expect(() => provider.mount(document.createElement("div"), opts)).toThrow(/v0\.2/);
  });
});
