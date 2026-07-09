import { describe, test, expect } from "bun:test";
import { OllamaModels } from "./ollama-models";
import type { Shell } from "./types";

function fakeShell(opts: { stdout?: string; throws?: Error }): Shell {
  return {
    async text(cmd) {
      if (opts.throws) throw opts.throws;
      return opts.stdout ?? "";
    },
    async run() {
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  };
}

const LIST_OUTPUT = [
  "NAME              ID              SIZE      MODIFIED",
  "llama3:latest     abcd1234ef56    4.7 GB    2 days ago",
  "mistral:7b        9876fedc5432    4.1 GB    5 days ago",
].join("\n");

describe("OllamaModels", () => {
  test("parses ollama list output into id/label pairs, skipping the header", async () => {
    const models = new OllamaModels({ shell: fakeShell({ stdout: LIST_OUTPUT }) });
    expect(await models.list()).toEqual([
      { id: "llama3:latest", label: "llama3:latest" },
      { id: "mistral:7b", label: "mistral:7b" },
    ]);
  });

  test("returns an empty list when ollama is not installed or the command fails", async () => {
    const models = new OllamaModels({ shell: fakeShell({ throws: new Error("ENOENT") }) });
    expect(await models.list()).toEqual([]);
  });

  test("returns an empty list when there are no models installed (header only)", async () => {
    const models = new OllamaModels({
      shell: fakeShell({ stdout: "NAME              ID              SIZE      MODIFIED\n" }),
    });
    expect(await models.list()).toEqual([]);
  });

  test("returns an empty list for completely blank output", async () => {
    const models = new OllamaModels({ shell: fakeShell({ stdout: "" }) });
    expect(await models.list()).toEqual([]);
  });
});
