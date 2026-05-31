import { describe, test, expect } from "bun:test";
import { defaultIds, emit, stdoutNotifier, defaultShell, HARDENED_ENV } from "./deps";

describe("defaultIds", () => {
  test("uuid returns prefixed unique string", () => {
    const a = defaultIds.uuid("test");
    const b = defaultIds.uuid("test");
    expect(a.startsWith("test_")).toBe(true);
    expect(a).not.toBe(b);
  });

  test("now returns positive integer", () => {
    expect(defaultIds.now()).toBeGreaterThan(0);
  });
});

describe("emit + notifier", () => {
  test("emit writes JSON-RPC notification to notifier", () => {
    const lines: string[] = [];
    const notifier = { write: (l: string) => lines.push(l) };
    emit(notifier, "pty.data", { ptyId: "x", data: "hi" });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.method).toBe("pty.data");
    expect(parsed.params).toEqual({ ptyId: "x", data: "hi" });
  });

  test("stdoutNotifier.write appends newline to stdout", () => {
    const orig = process.stdout.write.bind(process.stdout);
    const captured: string[] = [];
    (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
      captured.push(s);
      return true;
    };
    try {
      stdoutNotifier.write("hello");
    } finally {
      (process.stdout as unknown as { write: typeof orig }).write = orig;
    }
    expect(captured[0]).toBe("hello\n");
  });
});

describe("defaultShell", () => {
  test("text returns stdout of successful command", async () => {
    const out = await defaultShell.text(["echo", "hello"]);
    expect(out.trim()).toBe("hello");
  });

  test("text throws on non-zero exit", async () => {
    await expect(defaultShell.text(["sh", "-c", "exit 5"])).rejects.toThrow();
  });

  test("run captures stdout, stderr, exit code", async () => {
    const r = await defaultShell.run(["sh", "-c", "echo ok && echo err 1>&2 && exit 3"]);
    expect(r.stdout.trim()).toBe("ok");
    expect(r.stderr.trim()).toBe("err");
    expect(r.exitCode).toBe(3);
  });

  test("run pipes stdin bytes to the child process", async () => {
    // `cat` echoes its stdin to stdout — proves the bytes actually reach the shell.
    const payload = "patch-payload-é\nsecond line\n";
    const r = await defaultShell.run(["cat"], undefined, payload);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(payload);
  });

  test("run without stdin still works (stdin ignored)", async () => {
    const r = await defaultShell.run(["echo", "no-stdin"]);
    expect(r.stdout.trim()).toBe("no-stdin");
  });

  test("hardened env disables interactive git prompts and pins the locale", async () => {
    expect(HARDENED_ENV.GIT_TERMINAL_PROMPT).toBe("0");
    expect(HARDENED_ENV.LC_ALL).toBe("C");
    // Spawned children must actually inherit the hardened locale.
    const out = await defaultShell.text(["sh", "-c", "echo $LC_ALL"]);
    expect(out.trim()).toBe("C");
  });
});
