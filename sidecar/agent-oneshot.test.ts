import { describe, test, expect } from "bun:test";
import { oneShotSpecFor } from "./agent-oneshot";

describe("oneShotSpecFor", () => {
  test("claude / claude-code / empty / unknown all resolve to claude -p", () => {
    const claude = { command: "claude", args: ["-p", "--output-format", "text"] };
    expect(oneShotSpecFor("claude")).toEqual(claude);
    expect(oneShotSpecFor("claude-code")).toEqual(claude);
    expect(oneShotSpecFor("")).toEqual(claude);
    expect(oneShotSpecFor(undefined)).toEqual(claude);
    expect(oneShotSpecFor("aider")).toEqual(claude);
    expect(oneShotSpecFor("something-new")).toEqual(claude);
  });

  test("codex resolves to `codex exec`", () => {
    expect(oneShotSpecFor("codex")).toEqual({ command: "codex", args: ["exec"] });
  });

  test("gemini resolves to stdin-piped gemini", () => {
    expect(oneShotSpecFor("gemini")).toEqual({ command: "gemini", args: [] });
  });

  test("is case-insensitive", () => {
    expect(oneShotSpecFor("CODEX")).toEqual({ command: "codex", args: ["exec"] });
  });
});
