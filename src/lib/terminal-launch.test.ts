import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  shellQuote,
  buildLaunchCommandLine,
  wrapBracketedPaste,
  IdleWatcher,
  BRACKETED_PASTE_START,
  BRACKETED_PASTE_END,
  CR,
} from "./terminal-launch";

describe("shellQuote", () => {
  it("leaves safe words unquoted", () => {
    expect(shellQuote("claude")).toBe("claude");
    expect(shellQuote("--model=opus")).toBe("--model=opus");
    expect(shellQuote("./path/to-file_1")).toBe("./path/to-file_1");
  });

  it("quotes words with spaces or specials", () => {
    expect(shellQuote("hello world")).toBe("'hello world'");
    expect(shellQuote("a;b")).toBe("'a;b'");
  });

  it("quotes the empty string", () => {
    expect(shellQuote("")).toBe("''");
  });

  it("escapes embedded single quotes", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});

describe("buildLaunchCommandLine", () => {
  it("joins command + args and terminates with CR", () => {
    expect(buildLaunchCommandLine({ command: "claude", args: [] })).toBe("claude" + CR);
  });

  it("shell-quotes args needing it", () => {
    expect(
      buildLaunchCommandLine({ command: "codex", args: ["--flag", "two words"] })
    ).toBe(`codex --flag 'two words'` + CR);
  });
});

describe("wrapBracketedPaste", () => {
  it("wraps text in bracketed-paste markers and submits", () => {
    expect(wrapBracketedPaste("fix the bug")).toBe(
      BRACKETED_PASTE_START + "fix the bug" + BRACKETED_PASTE_END + CR
    );
  });
});

describe("IdleWatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires after the idle window with no further pushes", () => {
    const onFire = vi.fn();
    const w = new IdleWatcher({ idleMs: 400, capMs: 10_000, onFire });
    w.push();
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(399);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("resets the idle window on each push", () => {
    const onFire = vi.fn();
    const w = new IdleWatcher({ idleMs: 400, capMs: 10_000, onFire });
    w.push();
    vi.advanceTimersByTime(300);
    w.push();
    vi.advanceTimersByTime(300);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("fires at the cap even if output never goes idle", () => {
    const onFire = vi.fn();
    const w = new IdleWatcher({ idleMs: 400, capMs: 1000, onFire });
    for (let t = 0; t < 1000; t += 200) {
      w.push();
      vi.advanceTimersByTime(200);
    }
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("fires at most once", () => {
    const onFire = vi.fn();
    const w = new IdleWatcher({ idleMs: 400, capMs: 10_000, onFire });
    w.push();
    vi.advanceTimersByTime(500);
    w.push();
    vi.advanceTimersByTime(500);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("cancel() prevents firing", () => {
    const onFire = vi.fn();
    const w = new IdleWatcher({ idleMs: 400, capMs: 10_000, onFire });
    w.push();
    w.cancel();
    vi.advanceTimersByTime(10_000);
    expect(onFire).not.toHaveBeenCalled();
  });

  it("uses default idle/cap when not specified", () => {
    const onFire = vi.fn();
    const w = new IdleWatcher({ onFire });
    w.push();
    vi.advanceTimersByTime(400);
    expect(onFire).toHaveBeenCalledTimes(1);
  });
});
