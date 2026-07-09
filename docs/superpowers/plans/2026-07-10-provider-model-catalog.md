# Provider/Model/Pricing Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 7 drifted, hardcoded provider/model/pricing lists (Settings UI, Agent Mode, backend branding, cost estimator) with one `providers.json` catalog read directly by both the frontend and sidecar builds, plus live model listing for Ollama.

**Architecture:** `providers.json` at the repo root is the single data source. Two thin typed accessor modules (`src/lib/providers/catalog.ts`, `sidecar/providers/catalog.ts`) each `import` it directly — no IPC round trip for the static catalog. Ollama is the one provider with a real "list models" CLI (`ollama list`), so it gets a dedicated sidecar module + RPC case + Rust passthrough command + frontend wrapper, following the existing `project.destroy` passthrough pattern exactly.

**Tech Stack:** TypeScript (Vite frontend, Bun sidecar), Rust (Tauri v2), Vitest, bun:test, cargo test.

**Reference:** `docs/superpowers/specs/2026-07-10-provider-model-catalog-design.md` (design spec — read it first for the "why").

---

## Task 1: Derive `KnownBackendName` from a runtime array (drift-prevention foundation)

Today `KnownBackendName` in `src/lib/ipc.ts:660-667` is a hand-written literal union with no runtime equivalent, so nothing can assert the catalog's provider ids match it. Add a runtime array and derive the type from it, so later tasks can write a real drift-prevention test.

**Files:**
- Modify: `src/lib/ipc.ts:660-667`
- Test: `src/lib/ipc.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/ipc.test.ts` (inside the existing `describe("ipc types", ...)` block, alongside the other type imports at the top — add `KNOWN_BACKEND_NAMES` to the existing `import type { ... } from "./ipc"` list as a **value** import on its own line since it's not a type):

```ts
import { KNOWN_BACKEND_NAMES } from "./ipc";
```

```ts
  it("KNOWN_BACKEND_NAMES is the runtime source for KnownBackendName", () => {
    expect(KNOWN_BACKEND_NAMES).toEqual([
      "claude-code", "codex", "gemini", "aider", "opencode", "antigravity", "ollama",
    ]);
    const check: KnownBackendName = KNOWN_BACKEND_NAMES[0];
    expect(check).toBe("claude-code");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run src/lib/ipc.test.ts`
Expected: FAIL — `KNOWN_BACKEND_NAMES` is not exported from `./ipc`.

- [ ] **Step 3: Implement**

In `src/lib/ipc.ts`, replace lines 660-667:

```ts
export type KnownBackendName =
  | "claude-code"
  | "codex"
  | "gemini"
  | "aider"
  | "opencode"
  | "antigravity"
  | "ollama";
```

with:

```ts
export const KNOWN_BACKEND_NAMES = [
  "claude-code",
  "codex",
  "gemini",
  "aider",
  "opencode",
  "antigravity",
  "ollama",
] as const;

export type KnownBackendName = (typeof KNOWN_BACKEND_NAMES)[number];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run src/lib/ipc.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/ipc.ts src/lib/ipc.test.ts
git commit -m "refactor: derive KnownBackendName from a runtime array"
```

---

## Task 2: `providers.json` + frontend catalog accessor

**Files:**
- Create: `providers.json` (repo root)
- Create: `src/lib/providers/catalog.ts`
- Test: `src/lib/providers/catalog.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/providers/catalog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { KNOWN_BACKEND_NAMES } from "@/lib/ipc";
import {
  listProviders,
  getProvider,
  getModel,
  getDefaultModel,
  estimateCost3Tier,
} from "./catalog";

describe("providers catalog", () => {
  it("every KNOWN_BACKEND_NAMES id has exactly one catalog entry, and vice versa", () => {
    const ids = listProviders().map((p) => p.id);
    expect(new Set(ids)).toEqual(new Set(KNOWN_BACKEND_NAMES));
    expect(ids).toHaveLength(KNOWN_BACKEND_NAMES.length);
  });

  it("getProvider resolves a known id and returns undefined for an unknown one", () => {
    expect(getProvider("claude-code")?.label).toBe("Claude Code");
    expect(getProvider("not-a-backend")).toBeUndefined();
  });

  it("getModel resolves a model within its provider and undefined otherwise", () => {
    expect(getModel("claude-code", "claude-opus-4-8")?.label).toBe("Opus 4.8");
    expect(getModel("claude-code", "not-a-model")).toBeUndefined();
    expect(getModel("not-a-backend", "claude-opus-4-8")).toBeUndefined();
  });

  it("getDefaultModel resolves to a model actually present in that provider's models list", () => {
    const provider = getProvider("claude-code")!;
    const model = getDefaultModel("claude-code");
    expect(model).toBeDefined();
    expect(provider.models.some((m) => m.id === model!.id)).toBe(true);
    expect(model!.id).toBe(provider.defaultModel);
  });

  it("getDefaultModel returns undefined for providers with no default model yet", () => {
    expect(getDefaultModel("aider")).toBeUndefined();
    expect(getDefaultModel("ollama")).toBeUndefined();
  });

  it("ollama is marked dynamic with an empty static model list", () => {
    const ollama = getProvider("ollama")!;
    expect(ollama.dynamic).toBe(true);
    expect(ollama.models).toEqual([]);
  });

  it("estimateCost3Tier prices input/output/cache-read at their own rates and cache-creation at the input rate", () => {
    const cost = estimateCost3Tier("claude-code", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheCreationTokens: 1_000_000,
    });
    const model = getDefaultModel("claude-code")!;
    const expected =
      model.pricing!.inputPerMillion * 2 + // inputTokens + cacheCreationTokens both at input rate
      model.pricing!.outputPerMillion +
      model.pricing!.cachedPerMillion;
    expect(cost).toBeCloseTo(expected);
  });

  it("estimateCost3Tier returns 0 for a provider with no priced default model", () => {
    expect(
      estimateCost3Tier("aider", { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }),
    ).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run src/lib/providers/catalog.test.ts`
Expected: FAIL — cannot find module `./catalog` (neither the file nor `providers.json` exist yet).

- [ ] **Step 3: Implement**

Create `providers.json` at the repo root:

```json
{
  "providers": [
    {
      "id": "claude-code",
      "label": "Claude Code",
      "dynamic": false,
      "defaultModel": "claude-opus-4-8",
      "models": [
        {
          "id": "claude-opus-4-8",
          "label": "Opus 4.8",
          "pricing": { "inputPerMillion": 15, "outputPerMillion": 75, "cachedPerMillion": 1.5 }
        },
        {
          "id": "claude-sonnet-5",
          "label": "Sonnet 5",
          "pricing": { "inputPerMillion": 3, "outputPerMillion": 15, "cachedPerMillion": 0.3 }
        },
        {
          "id": "claude-haiku-4-5-20251001",
          "label": "Haiku 4.5",
          "pricing": { "inputPerMillion": 0.8, "outputPerMillion": 4, "cachedPerMillion": 0.08 }
        }
      ]
    },
    {
      "id": "codex",
      "label": "Codex",
      "dynamic": false,
      "defaultModel": "gpt-5",
      "models": [
        {
          "id": "gpt-5",
          "label": "GPT-5",
          "pricing": { "inputPerMillion": 10, "outputPerMillion": 30, "cachedPerMillion": 1 }
        },
        {
          "id": "gpt-5-mini",
          "label": "GPT-5 Mini",
          "pricing": { "inputPerMillion": 0.5, "outputPerMillion": 2, "cachedPerMillion": 0.05 }
        },
        {
          "id": "o4",
          "label": "o4",
          "pricing": { "inputPerMillion": 2, "outputPerMillion": 8, "cachedPerMillion": 0.2 }
        }
      ]
    },
    {
      "id": "gemini",
      "label": "Gemini CLI",
      "dynamic": false,
      "defaultModel": "gemini-2.5-pro",
      "models": [
        {
          "id": "gemini-2.5-pro",
          "label": "Gemini 2.5 Pro",
          "pricing": { "inputPerMillion": 1.25, "outputPerMillion": 10, "cachedPerMillion": 0.125 }
        },
        {
          "id": "gemini-2.5-flash",
          "label": "Gemini 2.5 Flash",
          "pricing": { "inputPerMillion": 0.15, "outputPerMillion": 0.6, "cachedPerMillion": 0.015 }
        }
      ]
    },
    { "id": "ollama", "label": "Ollama", "dynamic": true, "defaultModel": null, "models": [] },
    { "id": "aider", "label": "Aider", "dynamic": false, "defaultModel": null, "models": [] },
    { "id": "opencode", "label": "OpenCode", "dynamic": false, "defaultModel": null, "models": [] },
    { "id": "antigravity", "label": "Antigravity", "dynamic": false, "defaultModel": null, "models": [] }
  ]
}
```

Create `src/lib/providers/catalog.ts`:

```ts
import providersJson from "../../../providers.json";

export interface CatalogPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedPerMillion: number;
}

export interface CatalogModel {
  id: string;
  label: string;
  pricing: CatalogPricing | null;
}

export interface CatalogProvider {
  id: string;
  label: string;
  dynamic: boolean;
  defaultModel: string | null;
  models: CatalogModel[];
}

export interface CatalogUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

const DATA = providersJson as { providers: CatalogProvider[] };

export function listProviders(): CatalogProvider[] {
  return DATA.providers;
}

export function getProvider(id: string): CatalogProvider | undefined {
  return DATA.providers.find((p) => p.id === id);
}

export function getModel(providerId: string, modelId: string): CatalogModel | undefined {
  return getProvider(providerId)?.models.find((m) => m.id === modelId);
}

export function getDefaultModel(providerId: string): CatalogModel | undefined {
  const provider = getProvider(providerId);
  if (!provider?.defaultModel) return undefined;
  return provider.models.find((m) => m.id === provider.defaultModel);
}

export function estimateCost3Tier(providerId: string, usage: CatalogUsage): number {
  const model = getDefaultModel(providerId);
  if (!model?.pricing) return 0;
  const { inputPerMillion, outputPerMillion, cachedPerMillion } = model.pricing;
  return (
    (usage.inputTokens * inputPerMillion +
      usage.cacheCreationTokens * inputPerMillion +
      usage.outputTokens * outputPerMillion +
      usage.cacheReadTokens * cachedPerMillion) /
    1_000_000
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run src/lib/providers/catalog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add providers.json src/lib/providers/catalog.ts src/lib/providers/catalog.test.ts
git commit -m "feat: add providers.json catalog and frontend accessor"
```

---

## Task 3: Sidecar catalog accessor (mirrors Task 2)

**Files:**
- Modify: `sidecar/tsconfig.json`
- Create: `sidecar/providers/catalog.ts`
- Test: `sidecar/providers/catalog.test.ts`

- [ ] **Step 1: Write the failing test**

Create `sidecar/providers/catalog.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { listProviders, getProvider, getModel, getDefaultModel, estimateCost3Tier } from "./catalog";

const KNOWN_BACKEND_NAMES = ["claude-code", "codex", "gemini", "aider", "opencode", "antigravity", "ollama"];

describe("sidecar providers catalog", () => {
  test("catalog ids exactly match the frontend's KNOWN_BACKEND_NAMES", () => {
    const ids = listProviders().map((p) => p.id);
    expect(new Set(ids)).toEqual(new Set(KNOWN_BACKEND_NAMES));
  });

  test("getProvider / getModel / getDefaultModel resolve claude-code", () => {
    expect(getProvider("claude-code")?.label).toBe("Claude Code");
    expect(getModel("claude-code", "claude-opus-4-8")?.label).toBe("Opus 4.8");
    expect(getDefaultModel("claude-code")?.id).toBe("claude-opus-4-8");
  });

  test("unknown ids resolve to undefined, not throw", () => {
    expect(getProvider("nope")).toBeUndefined();
    expect(getModel("claude-code", "nope")).toBeUndefined();
    expect(getDefaultModel("aider")).toBeUndefined();
  });

  test("estimateCost3Tier matches the frontend formula", () => {
    const cost = estimateCost3Tier("claude-code", {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    const model = getDefaultModel("claude-code")!;
    expect(cost).toBeCloseTo(model.pricing!.inputPerMillion);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && bun test providers/catalog.test.ts`
Expected: FAIL — cannot find module `./catalog`.

- [ ] **Step 3: Implement**

Add `"resolveJsonModule": true` to `sidecar/tsconfig.json`'s `compilerOptions` (matches the frontend's `tsconfig.json:11`, needed so TypeScript type-checks the JSON import even though Bun resolves it at runtime regardless):

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "allowJs": false,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": false,
    "verbatimModuleSyntax": false,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "types": ["bun"]
  },
  "include": ["**/*.ts"]
}
```

Create `sidecar/providers/catalog.ts` (identical logic to `src/lib/providers/catalog.ts`, own copy per the project's two-trees convention since `sidecar/` and `src/` are separate build roots — both import the same root `providers.json`):

```ts
import providersJson from "../../providers.json";

export interface CatalogPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedPerMillion: number;
}

export interface CatalogModel {
  id: string;
  label: string;
  pricing: CatalogPricing | null;
}

export interface CatalogProvider {
  id: string;
  label: string;
  dynamic: boolean;
  defaultModel: string | null;
  models: CatalogModel[];
}

export interface CatalogUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

const DATA = providersJson as { providers: CatalogProvider[] };

export function listProviders(): CatalogProvider[] {
  return DATA.providers;
}

export function getProvider(id: string): CatalogProvider | undefined {
  return DATA.providers.find((p) => p.id === id);
}

export function getModel(providerId: string, modelId: string): CatalogModel | undefined {
  return getProvider(providerId)?.models.find((m) => m.id === modelId);
}

export function getDefaultModel(providerId: string): CatalogModel | undefined {
  const provider = getProvider(providerId);
  if (!provider?.defaultModel) return undefined;
  return provider.models.find((m) => m.id === provider.defaultModel);
}

export function estimateCost3Tier(providerId: string, usage: CatalogUsage): number {
  const model = getDefaultModel(providerId);
  if (!model?.pricing) return 0;
  const { inputPerMillion, outputPerMillion, cachedPerMillion } = model.pricing;
  return (
    (usage.inputTokens * inputPerMillion +
      usage.cacheCreationTokens * inputPerMillion +
      usage.outputTokens * outputPerMillion +
      usage.cacheReadTokens * cachedPerMillion) /
    1_000_000
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && bun test providers/catalog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sidecar/tsconfig.json sidecar/providers/catalog.ts sidecar/providers/catalog.test.ts
git commit -m "feat: add sidecar providers catalog accessor"
```

---

## Task 4: Sidecar Ollama model listing

**Files:**
- Create: `sidecar/ollama-models.ts`
- Test: `sidecar/ollama-models.test.ts`

- [ ] **Step 1: Write the failing test**

Create `sidecar/ollama-models.test.ts` (mirrors the fake-`Shell` pattern used in `sidecar/checks-module.test.ts`):

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && bun test ollama-models.test.ts`
Expected: FAIL — cannot find module `./ollama-models`.

- [ ] **Step 3: Implement**

Create `sidecar/ollama-models.ts`:

```ts
import { defaultShell } from "./deps";
import type { AgentModelOption, Shell } from "./types";

export interface OllamaModelsOptions {
  shell?: Shell;
}

export class OllamaModels {
  private shell: Shell;

  constructor(opts: OllamaModelsOptions = {}) {
    this.shell = opts.shell ?? defaultShell;
  }

  async list(): Promise<AgentModelOption[]> {
    let output: string;
    try {
      output = await this.shell.text(["ollama", "list"], undefined);
    } catch {
      return [];
    }
    return OllamaModels.parse(output);
  }

  static parse(output: string): AgentModelOption[] {
    const lines = output.trim().split("\n");
    if (lines.length <= 1) return [];
    return lines
      .slice(1)
      .map((line) => line.trim().split(/\s+/)[0])
      .filter((name): name is string => Boolean(name))
      .map((name) => ({ id: name, label: name }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && bun test ollama-models.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sidecar/ollama-models.ts sidecar/ollama-models.test.ts
git commit -m "feat: add live Ollama model listing via 'ollama list'"
```

---

## Task 5: Wire Ollama listing into the sidecar RPC dispatcher

**Files:**
- Modify: `sidecar/rpc-handlers.ts` (imports, `RpcHandlersOptions`, `RpcHandlers` fields, constructor, `dispatch()` switch)
- Test: `sidecar/rpc-handlers.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `sidecar/rpc-handlers.test.ts` (near the other single-module injection tests, e.g. next to the `checks.get` test read above):

```ts
test("providers.listOllamaModels delegates to the injected OllamaModels", async () => {
  const calls: string[] = [];
  const ollamaModels = {
    async list() {
      calls.push("list");
      return [{ id: "llama3:latest", label: "llama3:latest" }];
    },
  } as unknown as OllamaModels;
  const store = new SQLiteStore({ path: ":memory:", migrationsDir: defaultMigrationsDir() });
  const handlers = new RpcHandlers({ store, ollamaModels });
  const got = await handlers.dispatch("providers.listOllamaModels", {});
  expect(calls).toEqual(["list"]);
  expect(got).toEqual([{ id: "llama3:latest", label: "llama3:latest" }]);
});
```

Add `OllamaModels` to the test file's imports:

```ts
import { OllamaModels } from "./ollama-models";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && bun test rpc-handlers.test.ts -t "providers.listOllamaModels"`
Expected: FAIL — `RpcHandlersOptions` has no `ollamaModels` property / `dispatch` throws on an unknown method.

- [ ] **Step 3: Implement**

In `sidecar/rpc-handlers.ts`:

1. Add the import near the other module imports (after `import { HookServer } from "./hook-server";`):

```ts
import { OllamaModels } from "./ollama-models";
```

2. Add to `RpcHandlersOptions` (after `agents?: AgentSessionManager;`):

```ts
  ollamaModels?: OllamaModels;
```

3. Add to the `RpcHandlers` class fields (after `readonly agents: AgentSessionManager;`):

```ts
  readonly ollamaModels: OllamaModels;
```

4. Add to the constructor (after `this.agents = opts.agents ?? ...` — wherever that line is):

```ts
    this.ollamaModels = opts.ollamaModels ?? new OllamaModels();
```

5. Add a new case to `dispatch()`'s switch, alongside the other single-line delegating cases like `case "project.list":`:

```ts
      case "providers.listOllamaModels":
        return this.ollamaModels.list();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && bun test rpc-handlers.test.ts -t "providers.listOllamaModels"`
Expected: PASS

Then run the full sidecar suite to confirm nothing else broke:

Run: `cd sidecar && bun test`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add sidecar/rpc-handlers.ts sidecar/rpc-handlers.test.ts
git commit -m "feat: wire providers.listOllamaModels into the RPC dispatcher"
```

---

## Task 6: Rust passthrough command `list_ollama_models`

**Files:**
- Create: `src-tauri/src/commands/providers.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create the Rust command**

Create `src-tauri/src/commands/providers.rs` (mirrors `src-tauri/src/commands/project.rs`'s `project_list` — a zero-argument passthrough):

```rust
use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn list_ollama_models(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .sidecar
        .request("providers.listOllamaModels", json!({}))
        .await
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register the module and re-export**

In `src-tauri/src/commands/mod.rs`, add the module declaration (alphabetically, after `pub mod project_settings;`... actually before `pub mod pty;` to stay alphabetical — insert after `pub mod project_settings;` and before `pub mod pty;`):

```rust
pub mod providers;
```

Add the re-export (after `pub use project_settings::{...};` and before `pub use pty::{...};`):

```rust
pub use providers::list_ollama_models;
```

- [ ] **Step 3: Register the command handler**

In `src-tauri/src/lib.rs`, add `list_ollama_models,` to the `tauri::generate_handler![...]` list (anywhere in the list — add it right after `project_destroy,` for locality with the other `providers.*`-adjacent command):

```rust
        .invoke_handler(tauri::generate_handler![
            project_add,
            project_list,
            project_destroy,
            list_ollama_models,
            project_settings_get,
```

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors (there's no existing per-passthrough-command Rust test convention in this repo — `src-tauri/tests/jsonrpc_framing.rs` only covers the framing layer — so `cargo check` is the verification bar here, matching how `project_destroy` itself was added with no dedicated Rust test).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/providers.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add list_ollama_models Tauri passthrough command"
```

---

## Task 7: Frontend `listOllamaModels()` wrapper

**Files:**
- Modify: `src/lib/tauri.ts`
- Test: `src/lib/ipc.test.ts` (or a dedicated `tauri.test.ts` if one already covers similar wrappers — check first; this plan assumes none does and adds it to `ipc.test.ts` alongside other invoke-mock tests)

- [ ] **Step 1: Write the failing test**

Add to `src/lib/ipc.test.ts`:

```ts
import { listOllamaModels } from "./tauri";
```

```ts
  it("listOllamaModels invokes list_ollama_models and returns the result", async () => {
    (invoke as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: "llama3:latest", label: "llama3:latest" },
    ]);
    const models = await listOllamaModels();
    expect(invoke).toHaveBeenCalledWith("list_ollama_models");
    expect(models).toEqual([{ id: "llama3:latest", label: "llama3:latest" }]);
  });
```

(If `invoke` in `ipc.test.ts` isn't already a `vi.fn()` mock at this point in the file, check how the existing `projectSettingsGet` tests in the same file mock it, and follow that same setup — it already imports `vi` and `invoke` from `@tauri-apps/api/core` at the top of the file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run src/lib/ipc.test.ts`
Expected: FAIL — `listOllamaModels` is not exported from `./tauri`.

- [ ] **Step 3: Implement**

In `src/lib/tauri.ts`, add near `detectBackends` (after its closing brace, `:728`):

```ts
export async function listOllamaModels(): Promise<AgentModelOption[]> {
  return invoke("list_ollama_models");
}
```

Add `AgentModelOption` to `tauri.ts`'s existing type import from `./ipc` (find the current `import type { ... } from "./ipc"` line at the top of the file and add `AgentModelOption` to it).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run src/lib/ipc.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/tauri.ts src/lib/ipc.test.ts
git commit -m "feat: add listOllamaModels frontend wrapper"
```

---

## Task 8: Settings keys — rename to canonical ids, compute defaults from the catalog

**Files:**
- Modify: `src/lib/ipc.ts:564-567`
- Modify: `src/lib/stores/settings-defaults.ts:51-54`
- Test: `src/lib/stores/settings-defaults.test.ts` (check if it exists first — if not, create it)

- [ ] **Step 1: Write the failing test**

Check for an existing test file:

Run: `find src/lib/stores -iname "settings-defaults.test.ts"`

If it exists, add the following `it` block to it; if not, create `src/lib/stores/settings-defaults.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { SETTINGS_DEFAULTS } from "./settings-defaults";
import { getDefaultModel } from "@/lib/providers/catalog";

describe("SETTINGS_DEFAULTS models.*.id keys", () => {
  it("has exactly the four selectable-model provider keys, no 'pi'", () => {
    const modelKeys = Object.keys(SETTINGS_DEFAULTS).filter((k) => k.startsWith("models."));
    expect(new Set(modelKeys)).toEqual(
      new Set(["models.claude-code.id", "models.codex.id", "models.gemini.id", "models.ollama.id"]),
    );
  });

  it("claude-code/codex/gemini defaults match the catalog's default model id", () => {
    expect(SETTINGS_DEFAULTS["models.claude-code.id"]).toBe(getDefaultModel("claude-code")!.id);
    expect(SETTINGS_DEFAULTS["models.codex.id"]).toBe(getDefaultModel("codex")!.id);
    expect(SETTINGS_DEFAULTS["models.gemini.id"]).toBe(getDefaultModel("gemini")!.id);
  });

  it("ollama has no static default (its models are fetched live)", () => {
    expect(SETTINGS_DEFAULTS["models.ollama.id"]).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run src/lib/stores/settings-defaults.test.ts`
Expected: FAIL — `SETTINGS_DEFAULTS["models.claude-code.id"]` is `undefined` (key doesn't exist yet), TS also errors on the old key names once Step 3's `SettingsKey` type changes are made (do Step 3's `ipc.ts` edit and this edit together since they're type-coupled).

- [ ] **Step 3: Implement**

In `src/lib/ipc.ts`, replace lines 564-567:

```ts
  | "models.claude.id"
  | "models.codex.id"
  | "models.gemini.id"
  | "models.pi.id"
```

with:

```ts
  | "models.claude-code.id"
  | "models.codex.id"
  | "models.gemini.id"
  | "models.ollama.id"
```

In `src/lib/stores/settings-defaults.ts`:

1. Add the import at the top of the file (after the existing `import type { SettingsKey, SettingsValue } from "@/lib/ipc";`):

```ts
import { getDefaultModel } from "@/lib/providers/catalog";
```

2. Replace lines 51-54:

```ts
  // Models
  "models.claude.id": "claude-opus-4-7",
  "models.codex.id": "gpt-5",
  "models.gemini.id": "gemini-2.5-pro",
  "models.pi.id": "pi-1",
```

with:

```ts
  // Models — defaults come from the providers catalog (providers.json), not
  // literals, so this file can't drift from ModelsSettings.tsx again.
  // Ollama has no static default; its models are fetched live via `ollama list`.
  "models.claude-code.id": getDefaultModel("claude-code")!.id,
  "models.codex.id": getDefaultModel("codex")!.id,
  "models.gemini.id": getDefaultModel("gemini")!.id,
  "models.ollama.id": "",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run src/lib/stores/settings-defaults.test.ts`
Expected: PASS

Then run the full frontend suite to catch any other file still referencing the old key names:

Run: `bun run vitest run`
Expected: PASS (Task 9 fixes `ModelsSettings.tsx`, which will currently fail to compile/type-check against the new `SettingsKey` — if that test fails here, that's expected and gets fixed in Task 9, not this one; do not fix `ModelsSettings.tsx` in this task)

- [ ] **Step 5: Commit**

```bash
git add src/lib/ipc.ts src/lib/stores/settings-defaults.ts src/lib/stores/settings-defaults.test.ts
git commit -m "refactor: rename models.*.id settings keys to canonical provider ids"
```

---

## Task 9: `ModelsSettings.tsx` — read from the catalog, add live Ollama row

**Files:**
- Modify: `src/panels/settings/sections/ModelsSettings.tsx` (full rewrite of the `PROVIDERS` const and component)
- Modify: `src/panels/settings/sections/ModelsSettings.test.tsx` (full rewrite)

- [ ] **Step 1: Write the failing test**

Replace the contents of `src/panels/settings/sections/ModelsSettings.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "@/test/utils";
import ModelsSettings from "./ModelsSettings";
import { _resetSettingsStoreForTests } from "@/lib/stores/settings";
import * as tauri from "@/lib/tauri";

describe("ModelsSettings", () => {
  beforeEach(() => {
    _resetSettingsStoreForTests();
    vi.spyOn(tauri, "listOllamaModels").mockResolvedValue([
      { id: "llama3:latest", label: "llama3:latest" },
    ]);
  });

  it("renders one picker per catalog provider with a model list, plus Ollama", () => {
    renderWithProviders(<ModelsSettings />);
    expect(screen.getByTestId("model-claude-code")).toBeInTheDocument();
    expect(screen.getByTestId("model-codex")).toBeInTheDocument();
    expect(screen.getByTestId("model-gemini")).toBeInTheDocument();
    expect(screen.getByTestId("model-ollama")).toBeInTheDocument();
  });

  it("does not render a picker for providers with no models yet", () => {
    renderWithProviders(<ModelsSettings />);
    expect(screen.queryByTestId("model-aider")).not.toBeInTheDocument();
    expect(screen.queryByTestId("model-opencode")).not.toBeInTheDocument();
    expect(screen.queryByTestId("model-antigravity")).not.toBeInTheDocument();
  });

  it("does not render a 'pi' picker", () => {
    renderWithProviders(<ModelsSettings />);
    expect(screen.queryByTestId("model-pi")).not.toBeInTheDocument();
  });

  it("changes the Claude Code default model via select", async () => {
    renderWithProviders(<ModelsSettings />);
    const trigger = screen.getByTestId("model-claude-code");
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole("option", { name: /sonnet 5/i }));
    expect(trigger).toHaveTextContent(/Sonnet 5/i);
  });

  it("Ollama row fetches and lists live models", async () => {
    renderWithProviders(<ModelsSettings />);
    await waitFor(() => expect(tauri.listOllamaModels).toHaveBeenCalled());
    const trigger = screen.getByTestId("model-ollama");
    await userEvent.click(trigger);
    expect(await screen.findByRole("option", { name: "llama3:latest" })).toBeInTheDocument();
  });

  it("Ollama row shows an empty state when no models are installed or ollama is unavailable", async () => {
    vi.spyOn(tauri, "listOllamaModels").mockResolvedValue([]);
    renderWithProviders(<ModelsSettings />);
    await waitFor(() => expect(tauri.listOllamaModels).toHaveBeenCalled());
    expect(screen.getByTestId("model-ollama-empty")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run src/panels/settings/sections/ModelsSettings.test.tsx`
Expected: FAIL — `model-claude-code`/`model-ollama` testids don't exist yet, `listOllamaModels` isn't called.

- [ ] **Step 3: Implement**

Replace the entire contents of `src/panels/settings/sections/ModelsSettings.tsx`:

```tsx
import { useEffect, useState } from "react";
import { SettingsGroup } from "../primitives/SettingsGroup";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSelect } from "../primitives/SettingsSelect";
import { useSettings } from "@/lib/stores/settings";
import { listOllamaModels } from "@/lib/tauri";
import { listProviders, type CatalogProvider } from "@/lib/providers/catalog";
import type { SettingsKey } from "@/lib/ipc";

function settingsKeyFor(providerId: string): SettingsKey {
  return `models.${providerId}.id` as SettingsKey;
}

function StaticProviderRow({ provider }: { provider: CatalogProvider }) {
  const [model, setModel] = useSettings(settingsKeyFor(provider.id), provider.defaultModel ?? "");
  return (
    <SettingsRow
      title={provider.label}
      description={`Default model used when starting a ${provider.label} workspace.`}
      control={
        <SettingsSelect
          label={`${provider.label} default model`}
          value={model}
          onValueChange={setModel}
          options={provider.models.map((m) => ({ value: m.id, label: m.label }))}
          data-testid={`model-${provider.id}`}
        />
      }
    />
  );
}

function OllamaProviderRow({ provider }: { provider: CatalogProvider }) {
  const [model, setModel] = useSettings(settingsKeyFor(provider.id), "");
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    listOllamaModels()
      .then((models) => {
        if (!cancelled) setOptions(models.map((m) => ({ value: m.id, label: m.label })));
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (options.length === 0) {
    return (
      <SettingsRow
        title={provider.label}
        description="No local models detected. Install one with `ollama pull <model>`."
        control={<span data-testid="model-ollama-empty" className="text-[12px] text-muted-foreground">None found</span>}
      />
    );
  }

  return (
    <SettingsRow
      title={provider.label}
      description={`Default model used when starting an ${provider.label} workspace.`}
      control={
        <SettingsSelect
          label={`${provider.label} default model`}
          value={model}
          onValueChange={setModel}
          options={options}
          data-testid={`model-${provider.id}`}
        />
      }
    />
  );
}

export default function ModelsSettings() {
  const providers = listProviders().filter((p) => p.models.length > 0 || p.dynamic);
  return (
    <div data-testid="models-settings" className="space-y-5">
      <SettingsGroup title="Default models" description="Pick the model each provider should use by default.">
        {providers.map((p) =>
          p.dynamic ? (
            <OllamaProviderRow key={p.id} provider={p} />
          ) : (
            <StaticProviderRow key={p.id} provider={p} />
          ),
        )}
      </SettingsGroup>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run src/panels/settings/sections/ModelsSettings.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/panels/settings/sections/ModelsSettings.tsx src/panels/settings/sections/ModelsSettings.test.tsx
git commit -m "feat: ModelsSettings reads from the providers catalog, adds live Ollama row"
```

---

## Task 10: `GeneralSettings.tsx` — fix the backend picker to use canonical ids

**Files:**
- Modify: `src/panels/settings/sections/GeneralSettings.tsx:12-18,27`
- Modify: `src/lib/stores/settings-defaults.ts` (the `general.defaultBackend` default)
- Modify: `src/panels/settings/sections/GeneralSettings.test.tsx:16`

- [ ] **Step 1: Write the failing test**

In `src/panels/settings/sections/GeneralSettings.test.tsx`, replace the first test's body (the one using `fireEvent.change(screen.getByTestId("general-default-backend"), { target: { value: "codex" } })` — that one already uses `"codex"`, which stays valid) and add a new test asserting the option list matches the catalog:

```tsx
  it("backend picker options match the providers catalog plus 'other'", () => {
    renderWithProviders(<GeneralSettings />);
    const select = screen.getByTestId("general-default-backend") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual([
      "claude-code", "codex", "gemini", "aider", "opencode", "antigravity", "ollama", "other",
    ]);
  });
```

Also update the existing `"shows custom binary path input when defaultBackend is 'other'"` test and the one after it — they already set `"general.defaultBackend": "other"` directly via `useSettingsStore.setState`, which is unaffected by the id rename, so no change needed there.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run src/panels/settings/sections/GeneralSettings.test.tsx`
Expected: FAIL — current `select.options` values are `["claude","gemini","codex","pi","other"]`, not the catalog ids.

- [ ] **Step 3: Implement**

In `src/panels/settings/sections/GeneralSettings.tsx`:

1. Replace the import block's addition — add after the existing imports:

```ts
import { listProviders } from "@/lib/providers/catalog";
```

2. Replace lines 12-18:

```ts
const BACKENDS = [
  { value: "claude", label: "Claude" },
  { value: "gemini", label: "Gemini" },
  { value: "codex", label: "Codex" },
  { value: "pi", label: "Pi" },
  { value: "other", label: "Other (custom binary)" },
];
```

with:

```ts
const BACKENDS = [
  ...listProviders().map((p) => ({ value: p.id, label: p.label })),
  { value: "other", label: "Other (custom binary)" },
];
```

3. Update line 27's default value from `"claude"` to `"claude-code"` (matching what `BackendStep.tsx`'s first-run wizard actually writes into this same setting):

```ts
  const [defaultBackend, setDefaultBackend] = useSettings("general.defaultBackend", "claude-code");
```

In `src/lib/stores/settings-defaults.ts`, update the matching default (currently `"general.defaultBackend": "claude",` near the top of the file):

```ts
  "general.defaultBackend": "claude-code",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run src/panels/settings/sections/GeneralSettings.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/panels/settings/sections/GeneralSettings.tsx src/panels/settings/sections/GeneralSettings.test.tsx src/lib/stores/settings-defaults.ts
git commit -m "fix: GeneralSettings backend picker matches canonical provider ids"
```

---

## Task 11: `backend-brand.tsx` — source `label` from the catalog

**Files:**
- Modify: `src/lib/backend-brand.tsx:40-83`
- Create: `src/lib/backend-brand.test.tsx` (no test file exists for this module today)

- [ ] **Step 1: Write the failing test**

Create `src/lib/backend-brand.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { BACKEND_BRAND, brandFor } from "./backend-brand";
import { getProvider } from "./providers/catalog";
import { KNOWN_BACKEND_NAMES } from "./ipc";

describe("backend-brand", () => {
  it("every KnownBackendName has a brand entry", () => {
    for (const id of KNOWN_BACKEND_NAMES) {
      expect(BACKEND_BRAND[id]).toBeDefined();
    }
  });

  it("label is sourced from the providers catalog, not a separate literal", () => {
    for (const id of KNOWN_BACKEND_NAMES) {
      expect(BACKEND_BRAND[id].label).toBe(getProvider(id)!.label);
    }
  });

  it("brandFor resolves a known id and returns undefined for an unknown one", () => {
    expect(brandFor("claude-code")?.label).toBe("Claude Code");
    expect(brandFor("not-a-backend")).toBeUndefined();
  });

  it("every brand entry keeps its Icon, tagline, and installUrl", () => {
    for (const id of KNOWN_BACKEND_NAMES) {
      const brand = BACKEND_BRAND[id];
      expect(brand.Icon).toBeDefined();
      expect(brand.tagline.length).toBeGreaterThan(0);
      expect(brand.installUrl.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run src/lib/backend-brand.test.tsx`
Expected: FAIL — `label` is currently a literal that happens to match today's catalog values, but the test imports `getProvider` and compares by reference to catalog data, so it will only truly pass once `label` is wired to read from the catalog rather than coincidentally match it. (If it passes immediately because the literals already match, that's a signal the refactor is low-risk — proceed to Step 3 regardless, since the goal is removing the duplicate literal, not just matching values.)

- [ ] **Step 3: Implement**

In `src/lib/backend-brand.tsx`:

1. Add the import (after `import type { KnownBackendName } from "@/lib/ipc";`):

```ts
import { getProvider } from "./providers/catalog";
```

2. Replace each `label: "..."` literal in the `BACKEND_BRAND` object (lines 40-83) with a call to `getProvider`. The full replacement for lines 40-83:

```tsx
export const BACKEND_BRAND: Record<KnownBackendName, BackendBrand> = {
  "claude-code": {
    label: getProvider("claude-code")!.label,
    Icon: color(ClaudeCode),
    tagline: "Anthropic's official agentic CLI.",
    installUrl: "https://docs.claude.com/en/docs/claude-code",
  },
  codex: {
    label: getProvider("codex")!.label,
    Icon: color(Codex),
    tagline: "OpenAI's coding agent CLI.",
    installUrl: "https://developers.openai.com/codex/cli",
  },
  gemini: {
    label: getProvider("gemini")!.label,
    Icon: color(GeminiCLI),
    tagline: "Google's open-source CLI for Gemini.",
    installUrl: "https://geminicli.com/docs/get-started/installation/",
  },
  aider: {
    label: getProvider("aider")!.label,
    Icon: AiderFallback,
    tagline: "AI pair programming in your terminal.",
    installUrl: "https://aider.chat/docs/install.html",
  },
  opencode: {
    label: getProvider("opencode")!.label,
    Icon: color(OpenCode),
    tagline: "Open-source terminal coding agent.",
    installUrl: "https://opencode.ai",
  },
  antigravity: {
    label: getProvider("antigravity")!.label,
    Icon: color(Antigravity),
    tagline: "Google's agentic coding IDE.",
    installUrl: "https://antigravity.google",
  },
  ollama: {
    label: getProvider("ollama")!.label,
    Icon: color(Ollama),
    tagline: "Local models on your machine.",
    installUrl: "https://ollama.com",
  },
};

export function brandFor(name: string): BackendBrand | undefined {
  return (BACKEND_BRAND as Record<string, BackendBrand>)[name];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run src/lib/backend-brand.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/backend-brand.tsx src/lib/backend-brand.test.tsx
git commit -m "refactor: backend-brand labels sourced from the providers catalog"
```

---

## Task 12: `context-usage.ts` — 3-tier catalog-driven pricing

**Files:**
- Modify: `src/lib/context-usage.ts` (full rewrite of the pricing section)
- Modify: `src/lib/context-usage.test.ts` (full rewrite)

- [ ] **Step 1: Write the failing test**

Replace the contents of `src/lib/context-usage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  estimateTokensForMessages,
  estimateCostFromUsage,
  formatTokens,
} from "./context-usage";
import { getDefaultModel } from "./providers/catalog";

describe("context-usage helpers", () => {
  it("estimateTokens uses ~4 chars per token and handles empty input", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2); // ceil(5/4)
  });

  it("estimateTokensForMessages sums per-message estimates", () => {
    expect(
      estimateTokensForMessages([{ content: "abcd" }, { content: "abcdefgh" }])
    ).toBe(3); // 1 + 2
  });

  it("estimateCostFromUsage prices each tier at the backend's default model rate", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheCreationTokens: 0 };
    const model = getDefaultModel("claude-code")!;
    const expected = model.pricing!.inputPerMillion + model.pricing!.outputPerMillion + model.pricing!.cachedPerMillion;
    expect(estimateCostFromUsage(usage, "claude-code")).toBeCloseTo(expected);
  });

  it("estimateCostFromUsage prices cache-creation tokens at the input rate", () => {
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 1_000_000 };
    const model = getDefaultModel("claude-code")!;
    expect(estimateCostFromUsage(usage, "claude-code")).toBeCloseTo(model.pricing!.inputPerMillion);
  });

  it("estimateCostFromUsage returns 0 for a backend with no priced default model", () => {
    const usage = { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
    expect(estimateCostFromUsage(usage, "aider")).toBe(0);
  });

  it("formatTokens abbreviates thousands and millions", () => {
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });
});
```

Note: `pricePer1k` and `estimateCost` (the plain token-count-in, no-tier-breakdown functions) are deleted in this task — check their callers first:

Run: `grep -rn "pricePer1k\|estimateCost(" src --include="*.ts" --include="*.tsx" | grep -v "estimateCostFromUsage\|context-usage.test"`

If any non-test callers exist, this plan's Step 3 must update them to call `estimateCostFromUsage` (or `catalog.estimateCost3Tier` directly) with a real usage breakdown instead — do not leave a caller pointing at a deleted export. Handle any hits found here as part of Step 3 before moving on.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run src/lib/context-usage.test.ts`
Expected: FAIL — `estimateCostFromUsage("claude-code")` doesn't yet resolve `"claude-code"` to a catalog price (current code keys off substring match against `PRICE_PER_1K`, whose `claude` key happens to substring-match `claude-code`, so this may partially "pass" on old code by coincidence — the real signal is the cache-creation and no-priced-backend assertions, which will fail against the current flat-rate implementation).

- [ ] **Step 3: Implement**

Replace the entire contents of `src/lib/context-usage.ts`:

```ts
import type { Message } from "@/lib/ipc";
import { estimateCost3Tier, type CatalogUsage } from "@/lib/providers/catalog";

// A rough heuristic — ~4 characters per token. Used for client-side estimates
// only; the figure is always surfaced to the user as an estimate, never billed.
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateTokensForMessages(messages: Pick<Message, "content">[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

export function estimateCostFromUsage(usage: CatalogUsage, backend: string): number {
  return estimateCost3Tier(backend, usage);
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
```

If Step 1's grep found callers of the deleted `pricePer1k`/`estimateCost`, update each to call `estimateCostFromUsage` with a full `{ inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens }` object instead of a bare token count — construct that object from whatever token breakdown is already available at that call site (if only a single total is available there, put it under `inputTokens` and zero the rest, since that's the closest equivalent to the old flat-rate behavior).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run src/lib/context-usage.test.ts`
Expected: PASS

Then run the full frontend suite (this function is consumed by `useContextUsage.ts` and `UsagePanel.tsx` per the design doc's research):

Run: `bun run vitest run`
Expected: PASS — if `useContextUsage.test.ts` or `UsagePanel.test.tsx` fail because they assert specific flat-rate dollar amounts, update those assertions to compute their expected value via `getDefaultModel(backend)!.pricing` instead of a hardcoded number, the same way this task's own test does.

- [ ] **Step 5: Commit**

```bash
git add src/lib/context-usage.ts src/lib/context-usage.test.ts
git commit -m "feat: context-usage cost estimate uses 3-tier catalog pricing"
```

---

## Task 13: Agent Mode's Claude adapter reads models from the catalog

**Files:**
- Modify: `sidecar/agent/providers/claude.ts:9-14,230-242`
- Modify: `sidecar/agent/providers/claude.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `sidecar/agent/providers/claude.test.ts` (near the top-level `describe` blocks, as a new `describe`):

```ts
import { getProvider } from "../../providers/catalog";
```

```ts
describe("claudeAdapter.capabilities", () => {
  test("models come from the providers catalog plus the 'default' sentinel", () => {
    const caps = claudeAdapter.capabilities("/w");
    const catalogModels = getProvider("claude-code")!.models.map((m) => ({ id: m.id, label: m.label }));
    expect(caps.models).toEqual([{ id: "default", label: "Default" }, ...catalogModels]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && bun test agent/providers/claude.test.ts -t "claudeAdapter.capabilities"`
Expected: FAIL — current `MODELS` const is a stale hand-written list (`claude-opus-4-8`/`claude-sonnet-4-6`/`claude-haiku-4-5`), not the catalog's (`claude-opus-4-8`/`claude-sonnet-5`/`claude-haiku-4-5-20251001`).

- [ ] **Step 3: Implement**

In `sidecar/agent/providers/claude.ts`:

1. Add the import (after the existing `import type { AgentProviderAdapter, SpawnOpts, TurnContext } from "../provider";`):

```ts
import { getProvider } from "../../providers/catalog";
```

2. Replace lines 9-14:

```ts
const MODELS = [
  { id: "default", label: "Default" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
];
```

with:

```ts
const DEFAULT_MODEL_SENTINEL = { id: "default", label: "Default" };

function catalogModels() {
  return [DEFAULT_MODEL_SENTINEL, ...getProvider("claude-code")!.models.map((m) => ({ id: m.id, label: m.label }))];
}
```

3. In the `capabilities()` method (around line 230-242), replace `models: MODELS,` with:

```ts
      models: catalogModels(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && bun test agent/providers/claude.test.ts`
Expected: PASS (full file, to confirm nothing else in this adapter's existing tests broke)

- [ ] **Step 5: Commit**

```bash
git add sidecar/agent/providers/claude.ts sidecar/agent/providers/claude.test.ts
git commit -m "feat: Agent Mode's Claude adapter reads models from the providers catalog"
```

---

## Task 14: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Frontend build + full test + coverage**

Run: `bun run build`
Expected: succeeds with no type errors (this is the step that catches any remaining reference to a deleted export like `pricePer1k`, the old `models.claude.id` key, or the old `PROVIDERS` const anywhere not yet updated).

Run: `bun run test:coverage`
Expected: all tests pass; coverage stays at 100% lines / 95%+ branches per `CLAUDE.md`. If coverage drops, add the missing test case to whichever file introduced the gap — do not lower the threshold.

- [ ] **Step 2: Sidecar full test**

Run: `cd sidecar && bun test`
Expected: all tests pass, including the new `catalog.test.ts`, `ollama-models.test.ts`, and the updated `rpc-handlers.test.ts` / `claude.test.ts`.

- [ ] **Step 3: Rust check + test**

Run: `cd src-tauri && cargo check && cargo test --workspace`
Expected: compiles clean; existing tests (including `tests/jsonrpc_framing.rs`) still pass.

- [ ] **Step 4: Manual smoke check**

Run: `bun run tauri dev`

- Open Settings > Models: confirm Claude Code/Codex/Gemini/Ollama rows render, Ollama shows either live local models or the "None found" empty state (depending on whether Ollama is installed on the dev machine), and no "Pi" row appears.
- Open Settings > General: confirm the default-backend picker shows the 7 canonical names plus "Other (custom binary)", with no broken/blank selection.
- Open Agent Mode, start a Claude Code workspace, open the model menu: confirm it lists Opus 4.8 / Sonnet 5 / Haiku 4.5 (not the old Sonnet 4.6).

- [ ] **Step 5: Final commit (only if smoke check required fixes)**

If Step 4 surfaced any issue, fix it, re-run the relevant test file, then:

```bash
git add -A
git commit -m "fix: address issues found in provider catalog smoke check"
```

If Step 4 found nothing, there is nothing to commit — the plan is complete as of Task 13's commit.

---

## Self-Review Notes (completed during plan authoring)

- **Spec coverage:** every Non-Goal in the design spec is respected (no launch-wiring, no `general.defaultBackend`/`terminal.*.command` semantic changes beyond the id-name fix, no full per-model usage plumbing, "pi" dropped, no live listing attempted for Claude/Codex/Gemini). Every Decision row has a corresponding task. The design spec's `cacheCreationTokens → inputPerMillion` mapping and the CI drift guardrail are both implemented (Task 1 + Task 2's test).
- **Placeholder scan:** no TBD/TODO; `providers.json` pricing values are concrete numbers (not `0`), called out in Task 2 as current best-effort public list prices.
- **Type consistency:** `CatalogModel`/`CatalogProvider`/`CatalogUsage` are defined once per tree (Task 2 frontend, Task 3 sidecar) and reused verbatim by every later task that touches pricing or models — no renamed fields across tasks. `AgentModelOption` (pre-existing in both `ipc.ts` and `sidecar/types.ts`) is reused for the Ollama list return type rather than inventing a new shape.
