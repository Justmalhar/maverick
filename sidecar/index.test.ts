import { describe, test, expect } from "bun:test";
import { processLine, runServer } from "./index";
import { RpcHandlers } from "./rpc-handlers";
import { SQLiteStore, defaultMigrationsDir } from "./sqlite-store";

function makeHandlers(): RpcHandlers {
  let n = 0;
  const ids = { uuid: (p: string) => `${p}_${++n}`, now: () => 1 };
  const store = new SQLiteStore({ path: ":memory:", migrationsDir: defaultMigrationsDir(), ids });
  return new RpcHandlers({ store });
}

describe("processLine", () => {
  test("dispatches a request and writes a response", async () => {
    const lines: string[] = [];
    const notifier = { write: (l: string) => lines.push(l) };
    await processLine(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "project.list", params: {} }),
      makeHandlers(),
      notifier
    );
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.id).toBe(1);
    expect(Array.isArray(parsed.result)).toBe(true);
  });

  test("returns parse-error on invalid JSON", async () => {
    const lines: string[] = [];
    await processLine("not-json", makeHandlers(), { write: (l) => lines.push(l) });
    const parsed = JSON.parse(lines[0]);
    expect(parsed.error.code).toBe(-32700);
  });

  test("returns Invalid Request when method missing", async () => {
    const lines: string[] = [];
    await processLine(JSON.stringify({ id: 2 }), makeHandlers(), { write: (l) => lines.push(l) });
    const parsed = JSON.parse(lines[0]);
    expect(parsed.error.code).toBe(-32600);
  });

  test("returns internal error on handler throw", async () => {
    const lines: string[] = [];
    await processLine(
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "does.not.exist", params: {} }),
      makeHandlers(),
      { write: (l) => lines.push(l) }
    );
    const parsed = JSON.parse(lines[0]);
    expect(parsed.error.code).toBe(-32603);
    expect(parsed.error.message).toContain("Unknown method");
  });

  test("ignores empty lines silently", async () => {
    const lines: string[] = [];
    await processLine("   ", makeHandlers(), { write: (l) => lines.push(l) });
    expect(lines).toHaveLength(0);
  });

  test("invalid request when method is non-string preserves id", async () => {
    const lines: string[] = [];
    await processLine(
      JSON.stringify({ id: 7, method: 5 }),
      makeHandlers(),
      { write: (l) => lines.push(l) }
    );
    const parsed = JSON.parse(lines[0]);
    expect(parsed.id).toBe(7);
  });

  test("missing id is normalized in response", async () => {
    const lines: string[] = [];
    await processLine(
      JSON.stringify({ jsonrpc: "2.0", method: "project.list", params: {} }),
      makeHandlers(),
      { write: (l) => lines.push(l) }
    );
    const parsed = JSON.parse(lines[0]);
    expect(parsed.id).toBe(0);
  });
});

describe("runServer entrypoint", () => {
  test("processes stdin lines and writes responses to stdout", async () => {
    const { mkdtempSync, rmSync } = require("fs");
    const { tmpdir } = require("os");
    const { join } = require("path");
    const tmp = mkdtempSync(join(tmpdir(), "mvk-run-"));
    try {
      const proc = Bun.spawn(["bun", "run", `${import.meta.dir}/main.ts`], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, HOME: tmp, APPDATA: tmp },
      });
      proc.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id: 99, method: "project.list", params: {} }) + "\n"
      );
      proc.stdin.end();
      const out = await new Response(proc.stdout).text();
      await proc.exited;
      const line = out.trim().split("\n").pop()!;
      const parsed = JSON.parse(line);
      expect(parsed.id).toBe(99);
      expect(Array.isArray(parsed.result)).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 30_000);

  test("runServer is exported and constructs defaults", () => {
    expect(typeof runServer).toBe("function");
  });

  test("runServer ticks MCP health on its interval then clears the timer", async () => {
    const handlers = makeHandlers();
    let ticks = 0;
    handlers.pollMcpHealth = () => {
      ticks++;
    };
    async function* gen() {
      // Give the interval time to fire at least once before stdin drains.
      await new Promise((r) => setTimeout(r, 25));
      yield JSON.stringify({ jsonrpc: "2.0", id: 1, method: "project.list", params: {} });
    }
    await runServer({
      handlers,
      notifier: { write: () => {} },
      input: gen() as AsyncIterable<string>,
      healthIntervalMs: 5,
    });
    expect(ticks).toBeGreaterThan(0);
  });

  test("runServer with healthIntervalMs<=0 disables the timer", async () => {
    const handlers = makeHandlers();
    let ticks = 0;
    handlers.pollMcpHealth = () => {
      ticks++;
    };
    async function* gen() {
      await new Promise((r) => setTimeout(r, 15));
      yield JSON.stringify({ jsonrpc: "2.0", id: 1, method: "project.list", params: {} });
    }
    await runServer({
      handlers,
      notifier: { write: () => {} },
      input: gen() as AsyncIterable<string>,
      healthIntervalMs: 0,
    });
    expect(ticks).toBe(0);
  });

  test("runServer consumes injected async input", async () => {
    const lines: string[] = [];
    async function* gen() {
      yield JSON.stringify({ jsonrpc: "2.0", id: 1, method: "project.list", params: {} });
      yield "" as unknown as string;
      yield 5 as unknown as string;
    }
    await runServer({
      handlers: makeHandlers(),
      notifier: { write: (l) => lines.push(l) },
      input: gen() as AsyncIterable<string>,
    });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.id).toBe(1);
  });
});
