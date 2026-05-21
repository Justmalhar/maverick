import { describe, test, expect } from "bun:test";
import { ConfigLoader, MaverickConfigSchema } from "./config-loader";

const MIN_CONFIG = `
version: 1
backends:
  default: claude
  available:
    - { name: claude, command: claude, args: [] }
`;

const FULL_CONFIG = `
version: 1
backends:
  default: claude
  available:
    - { name: claude, command: claude, args: ["--print"] }
worktrees:
  base: .maverick/worktrees
skills:
  - { name: review, description: "Code review", prompt: "Review {{file}}" }
presets:
  - name: triple
    layout:
      type: split
      direction: h
      ratio: 0.5
      left:
        type: terminal
        agent: claude
        cwd: '{{workspace_root}}'
        mode: agent
      right:
        type: split
        direction: v
        ratio: 0.5
        top:
          type: terminal
          agent: bash
          cwd: '{{workspace_root}}'
          mode: terminal
        bottom:
          type: browser
          url: https://example.com
automations:
  - name: deploy
    trigger: manual
    steps:
      - { type: shell, command: "echo hi" }
mcps:
  - { name: filesys, command: mcp-fs, args: [] }
`;

describe("ConfigLoader", () => {
  test("loads minimal YAML", () => {
    const loader = new ConfigLoader({
      read: () => MIN_CONFIG,
      exists: (p) => p.endsWith("maverick.yaml"),
    });
    const cfg = loader.load("/project");
    expect(cfg.backends.default).toBe("claude");
  });

  test("loads full YAML including nested presets", () => {
    const loader = new ConfigLoader({
      read: () => FULL_CONFIG,
      exists: (p) => p.endsWith("maverick.yaml"),
    });
    const cfg = loader.load("/project");
    expect(cfg.skills?.[0].name).toBe("review");
    expect(cfg.presets).toHaveLength(1);
    expect(cfg.mcps?.[0].name).toBe("filesys");
  });

  test("falls back to maverick.json when yaml missing", () => {
    const loader = new ConfigLoader({
      read: () => JSON.stringify({
        version: 1,
        backends: { default: "codex", available: [{ name: "codex", command: "codex", args: [] }] },
      }),
      exists: (p) => p.endsWith("maverick.json"),
    });
    const cfg = loader.load("/project");
    expect(cfg.backends.default).toBe("codex");
  });

  test("throws when no config present", () => {
    const loader = new ConfigLoader({ read: () => "", exists: () => false });
    expect(() => loader.load("/x")).toThrow(/maverick.yaml not found/);
  });

  test("throws on schema violation", () => {
    const loader = new ConfigLoader({
      read: () => "version: 1\nbackends: {}\n",
      exists: () => true,
    });
    expect(() => loader.load("/x")).toThrow();
  });

  test("MaverickConfigSchema exported and validates", () => {
    const result = MaverickConfigSchema.safeParse({
      version: 1,
      backends: { default: "x", available: [] },
    });
    expect(result.success).toBe(true);
  });

  test("default constructor builds without DI", () => {
    expect(new ConfigLoader()).toBeInstanceOf(ConfigLoader);
  });

  test("default fs-backed loader reads real maverick.yaml", () => {
    const { mkdtempSync, rmSync, writeFileSync } = require("fs");
    const { tmpdir } = require("os");
    const { join } = require("path");
    const tmp = mkdtempSync(join(tmpdir(), "mvk-cfg-"));
    try {
      writeFileSync(join(tmp, "maverick.yaml"), MIN_CONFIG, "utf8");
      const cfg = new ConfigLoader().load(tmp);
      expect(cfg.version).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("default loader throws when no config files exist", () => {
    const { mkdtempSync, rmSync } = require("fs");
    const { tmpdir } = require("os");
    const { join } = require("path");
    const tmp = mkdtempSync(join(tmpdir(), "mvk-cfg-empty-"));
    try {
      expect(() => new ConfigLoader().load(tmp)).toThrow(/not found/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
