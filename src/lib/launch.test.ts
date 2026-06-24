import { describe, it, expect, beforeEach } from "vitest";
import { resolveLaunch } from "./launch";
import { useWorkbench } from "@/state/store";
import { makeBackend } from "@/test/fixtures";

beforeEach(() => useWorkbench.setState({ backends: [] }));

describe("resolveLaunch", () => {
  it("uses the backend's configured command + args from the store", () => {
    useWorkbench.setState({
      backends: [makeBackend({ id: "claude-code", command: "claude --resume", args: ["-x"] })],
    });
    expect(resolveLaunch("claude-code")).toEqual({ command: "claude --resume", args: ["-x"] });
  });

  it("falls back to the command map when the backend isn't in the store", () => {
    expect(resolveLaunch("claude-code")).toEqual({ command: "claude", args: [] });
    expect(resolveLaunch("codex")).toEqual({ command: "codex", args: [] });
  });

  it("falls back to the id itself for an unknown backend", () => {
    expect(resolveLaunch("mystery")).toEqual({ command: "mystery", args: [] });
  });
});
