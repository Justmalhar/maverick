import { describe, it, expect } from "vitest";
import { stripAnsi } from "./strip-ansi";

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

describe("stripAnsi", () => {
  it("strips CSI sequences: colors, private modes, screen clears", () => {
    expect(stripAnsi(ESC + "[1mhi" + ESC + "[22m")).toBe("hi");
    expect(stripAnsi(ESC + "[?2004h" + ESC + "[2Jbun install")).toBe("bun install");
    expect(stripAnsi(ESC + "[?25l" + ESC + "[?9001h" + ESC + "[?1004h")).toBe("");
  });

  it("strips OSC window-title sequences (PowerShell sets the title)", () => {
    expect(stripAnsi(ESC + "]0;C:\\windows\\powershell" + BEL + "bun install")).toBe(
      "bun install",
    );
  });

  it("normalizes CRLF to LF and drops bare CR (progress redraws)", () => {
    expect(stripAnsi("a\r\nb\rc")).toBe("a\nbc");
  });

  it("leaves plain text untouched", () => {
    expect(stripAnsi("Checked 1256 installs across 1348 packages")).toBe(
      "Checked 1256 installs across 1348 packages",
    );
  });
});
