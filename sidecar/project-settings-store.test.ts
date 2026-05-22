import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join, basename } from "path";
import { ProjectSettingsStore } from "./project-settings-store";

let dir: string;
let store: ProjectSettingsStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mvk-pset-"));
  store = new ProjectSettingsStore();
});

describe("ProjectSettingsStore", () => {
  it("returns defaults when maverick.json does not exist", () => {
    const settings = store.read(dir);
    expect(settings.name).toBe(basename(dir));
    expect(settings.scripts.setup).toBe("");
  });

  it("write creates the file atomically and merges into existing config", () => {
    writeFileSync(
      join(dir, "maverick.json"),
      JSON.stringify({ version: 1, backends: { default: "claude", available: [] } })
    );
    store.write(dir, { scripts: { setup: "bun install", run: "bun run dev", archive: "" } });
    const raw = JSON.parse(readFileSync(join(dir, "maverick.json"), "utf8"));
    expect(raw.project.scripts.setup).toBe("bun install");
    expect(raw.backends.default).toBe("claude");
    expect(existsSync(join(dir, "maverick.json.tmp"))).toBe(false);
  });

  it("write creates the file from scratch with version=1 when missing", () => {
    store.write(dir, { remote: "upstream" });
    const raw = JSON.parse(readFileSync(join(dir, "maverick.json"), "utf8"));
    expect(raw.version).toBe(1);
    expect(raw.project.remote).toBe("upstream");
  });

  it("read returns merged defaults applied", () => {
    writeFileSync(
      join(dir, "maverick.json"),
      JSON.stringify({ version: 1, backends: { default: "claude", available: [] }, project: { scripts: { setup: "echo hi" } } })
    );
    const s = store.read(dir);
    expect(s.scripts.setup).toBe("echo hi");
    expect(s.workspaces.branchFrom).toBe("origin/main");
  });

  it("rejects path-escape entries in filesToCopy on write", () => {
    expect(() =>
      store.write(dir, { workspaces: { branchFrom: "origin/main", filesToCopy: ["../escape.txt"] } } as never)
    ).toThrow(/path/i);
  });
});
