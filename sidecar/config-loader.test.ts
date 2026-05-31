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

describe("ConfigLoader.save", () => {
  function harness(seed?: { yaml?: string; json?: string }) {
    const files: Record<string, string> = {};
    if (seed?.yaml !== undefined) files["/p/maverick.yaml"] = seed.yaml;
    if (seed?.json !== undefined) files["/p/maverick.json"] = seed.json;
    const loader = new ConfigLoader({
      read: (path) => files[path] ?? "",
      exists: (path) => path in files,
      write: (path, contents) => {
        files[path] = contents;
      },
    });
    return { loader, files };
  }

  test("merges a patch into existing YAML and persists it", () => {
    const { loader, files } = harness({ yaml: MIN_CONFIG });
    const saved = loader.save("/p", {
      automations: [{ name: "build", trigger: "manual", steps: [{ type: "shell", command: "x" }] }],
    });
    expect(saved.automations?.[0].name).toBe("build");
    // Re-reading the written file yields the same automation.
    const round = loader.load("/p");
    expect(round.automations?.[0].name).toBe("build");
    expect(files["/p/maverick.yaml"]).toContain("build");
  });

  test("writes JSON when only maverick.json exists", () => {
    const { loader, files } = harness({
      json: JSON.stringify({ version: 1, backends: { default: "claude", available: [] } }),
    });
    loader.save("/p", { mcps: [{ name: "fs", command: "mcp-fs", args: [] }] });
    expect(files["/p/maverick.json"]).toContain("\"fs\"");
    expect(files["/p/maverick.yaml"]).toBeUndefined();
  });

  test("creates a default YAML config when none exists", () => {
    const { loader, files } = harness();
    const saved = loader.save("/p", { mcps: [{ name: "fs", command: "c", args: [] }] });
    expect(saved.version).toBe(1);
    expect(saved.backends.default).toBe("claude");
    expect(files["/p/maverick.yaml"]).toBeDefined();
  });

  test("ignores a non-object on-disk config and falls back to defaults", () => {
    const { loader } = harness({ yaml: "null\n" });
    const saved = loader.save("/p", { skills: [] });
    expect(saved.version).toBe(1);
  });

  test("validates the merged config against the schema", () => {
    const { loader } = harness({ yaml: MIN_CONFIG });
    expect(() =>
      loader.save("/p", { backends: { default: 1 } as never })
    ).toThrow();
  });

  test("default fs-backed save round-trips through disk", () => {
    const { mkdtempSync, rmSync, writeFileSync } = require("fs");
    const { tmpdir } = require("os");
    const { join } = require("path");
    const tmp = mkdtempSync(join(tmpdir(), "mvk-cfg-save-"));
    try {
      writeFileSync(join(tmp, "maverick.yaml"), MIN_CONFIG, "utf8");
      const loader = new ConfigLoader();
      loader.save(tmp, {
        automations: [{ name: "ship", trigger: "manual", steps: [] }],
      });
      expect(loader.load(tmp).automations?.[0].name).toBe("ship");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
