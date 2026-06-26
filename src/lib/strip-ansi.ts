// Strip ANSI/VT control sequences so raw PTY output renders cleanly as plain
// text in the Setup/Run log (which is a <pre>, not a terminal). PowerShell in a
// PTY emits many of these: private-mode toggles (bracketed paste, focus,
// win32-input, cursor hide), screen clears, SGR colors, and OSC window titles.
//
// The ESC/BEL bytes are built with String.fromCharCode so this source file
// stays pure ASCII (no literal control bytes to get mangled by editors).
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

const ANSI_RE = new RegExp(
  [
    // OSC: ESC ] ... terminated by BEL or ST (ESC backslash)
    ESC + "\\][\\s\\S]*?(?:" + BEL + "|" + ESC + "\\\\)",
    // CSI: ESC [ params(0x30-0x3F) intermediates(0x20-0x2F) final(0x40-0x7E)
    ESC + "\\[[0-?]*[ -/]*[@-~]",
    // Other two-char escapes: ESC + a single byte in @-Z, backslash, ]-_
    ESC + "[@-Z\\\\-_]",
  ].join("|"),
  "g",
);

const BEL_RE = new RegExp(BEL, "g");

/** Remove ANSI/VT sequences, stray BELs, and normalize carriage returns. */
export function stripAnsi(input: string): string {
  return input.replace(ANSI_RE, "").replace(BEL_RE, "").replace(/\r\n/g, "\n").replace(/\r/g, "");
}
