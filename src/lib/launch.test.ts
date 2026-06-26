import { describe, it, expect, beforeEach } from "vitest";
import { resolveLaunch, parseCommandLine, resolveStartupLaunch } from "./launch";
import { useWorkbench } from "@/state/store";
import { useSettingsStore, _resetSettingsStoreForTests } from "@/lib/stores/settings";
import { makeBackend } from "@/test/fixtures";

beforeEach(() => {
  useWorkbench.setState({ backends: [] });
  _resetSettingsStoreForTests();
});

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

describe("parseCommandLine", () => {
  it("splits command + args on whitespace", () => {
    expect(parseCommandLine("claude --dangerously-skip-permissions")).toEqual({
      command: "claude",
      args: ["--dangerously-skip-permissions"],
    });
    expect(parseCommandLine("  bun   run   dev ")).toEqual({ command: "bun", args: ["run", "dev"] });
    expect(parseCommandLine("")).toEqual({ command: "", args: [] });
  });
});

describe("resolveStartupLaunch", () => {
  it("uses the configured startup command when set", () => {
    useSettingsStore.setState({ values: { "general.startupCommand": "claude --dangerously-skip-permissions" } });
    expect(resolveStartupLaunch("claude-code")).toEqual({
      command: "claude",
      args: ["--dangerously-skip-permissions"],
    });
  });

  it("falls back to the backend command when no startup command is set", () => {
    expect(resolveStartupLaunch("claude-code")).toEqual({ command: "claude", args: [] });
  });
});
