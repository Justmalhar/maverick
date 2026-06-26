import { describe, test, expect } from "bun:test";
import {
  defaultIds,
  emit,
  stdoutNotifier,
  defaultShell,
  HARDENED_ENV,
  toolAugmentedPath,
  repairToolPath,
  shellCommandArgs,
} from "./deps";

describe("shellCommandArgs", () => {
  test("uses PowerShell on Windows", () => {
    expect(shellCommandArgs("echo hi", "win32")).toEqual([
      "powershell",
      "-NoProfile",
      "-Command",
      "echo hi",
    ]);
  });
  test("uses /bin/sh on POSIX", () => {
    expect(shellCommandArgs("echo hi", "linux")).toEqual(["/bin/sh", "-c", "echo hi"]);
    expect(shellCommandArgs("echo hi", "darwin")).toEqual(["/bin/sh", "-c", "echo hi"]);
  });
});

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

describe("toolAugmentedPath", () => {
  test("appends standard Unix tool dirs missing from a minimal PATH", () => {
    const result = toolAugmentedPath("/usr/bin:/bin", "darwin");
    const dirs = result!.split(":");
    expect(dirs).toContain("/opt/homebrew/bin");
    expect(dirs).toContain("/usr/local/bin");
    // Pre-existing dirs keep their leading position/priority.
    expect(dirs[0]).toBe("/usr/bin");
    expect(dirs[1]).toBe("/bin");
  });

  test("does not duplicate dirs already present", () => {
    const result = toolAugmentedPath("/opt/homebrew/bin:/usr/bin", "darwin");
    const dirs = result!.split(":");
    expect(dirs.filter((d) => d === "/opt/homebrew/bin")).toHaveLength(1);
    expect(dirs.filter((d) => d === "/usr/bin")).toHaveLength(1);
  });

  test("handles an empty/undefined PATH by returning just the tool dirs", () => {
    const result = toolAugmentedPath(undefined, "darwin");
    expect(result!.split(":")).toContain("/opt/homebrew/bin");
    expect(result).not.toStartWith(":");
  });

  test("leaves PATH untouched on Windows", () => {
    expect(toolAugmentedPath("C:\\Windows", "win32")).toBe("C:\\Windows");
  });
});

describe("repairToolPath", () => {
  test("augments the live process PATH (idempotently)", () => {
    const original = process.env.PATH;
    try {
      process.env.PATH = "/usr/bin:/bin";
      repairToolPath();
      const first = process.env.PATH;
      if (process.platform === "win32") {
        // win32 is a no-op by design: the Unix tool dirs don't exist there, so
        // toolAugmentedPath returns PATH unchanged.
        expect(first).toBe("/usr/bin:/bin");
      } else {
        expect(first!.split(":")).toContain("/opt/homebrew/bin");
      }
      repairToolPath();
      // Re-running does not grow the PATH with duplicates.
      expect(process.env.PATH).toBe(first);
    } finally {
      process.env.PATH = original;
    }
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

  test("run kills a child that exceeds its timeout budget (exit 124, no orphan)", async () => {
    const start = Date.now();
    const r = await defaultShell.run(
      ["bun", "-e", "await Bun.sleep(10000)"],
      undefined,
      undefined,
      { timeoutMs: 200 }
    );
    const elapsed = Date.now() - start;
    expect(r.exitCode).toBe(124);
    expect(r.stderr).toContain("timed out");
    // Reaped near the 200ms budget — nowhere near the 10s the child would sleep.
    expect(elapsed).toBeLessThan(5000);
  });

  test("run leaves a fast command untouched when a generous timeout is set", async () => {
    const r = await defaultShell.run(["echo", "quick"], undefined, undefined, { timeoutMs: 30_000 });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("quick");
  });

  test("hardened env disables interactive git prompts and pins the locale", async () => {
    expect(HARDENED_ENV.GIT_TERMINAL_PROMPT).toBe("0");
    expect(HARDENED_ENV.LC_ALL).toBe("C");
    // Spawned children must actually inherit the hardened locale.
    const out = await defaultShell.text(["sh", "-c", "echo $LC_ALL"]);
    expect(out.trim()).toBe("C");
  });
});
