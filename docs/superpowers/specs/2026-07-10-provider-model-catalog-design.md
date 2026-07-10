# Provider/Model/Pricing Catalog — Design

*Date: 2026-07-10 · Branch: `fix/models-config`*

## Problem

AI provider identity, model catalogs, and pricing are duplicated across at least
seven independent hardcoded lists in the frontend and sidecar, and they have
already drifted out of sync with each other:

- `src/panels/settings/sections/ModelsSettings.tsx:15-55` — `PROVIDERS` array
  (models per provider for the Settings > Models pickers). Keyed by
  `claude/codex/gemini/pi`. Default model `claude-opus-4-7`.
- `sidecar/agent/providers/claude.ts:9-14` — `MODELS` array feeding Agent Mode's
  model selector via `capabilities().models`. Default model list includes
  `claude-opus-4-8` — **already disagrees** with Settings' `claude-opus-4-7`.
- `src/lib/stores/settings-defaults.ts:51-54` — duplicate default model id
  literals for the same four keys.
- `src/lib/ipc.ts:564-567` — `SettingsKey` union hardcodes the same four
  `models.<provider>.id` key names.
- Backend *identity* (separate from model catalogs, but the same smell) is
  triplicated: `KnownBackendName` (`src/lib/ipc.ts:660-667`, 7 canonical ids),
  `BACKEND_BRAND` (`src/lib/backend-brand.tsx:40-83`, same 7), and
  `GeneralSettings.tsx:12-18`'s own `BACKENDS` array (5 ids: `claude/gemini/
  codex/pi/other` — wrong/incomplete relative to the other two, and confirmed
  to actually diverge from what `BackendStep.tsx` / `detectBackends()` write
  into the same `general.defaultBackend` setting via canonical ids).
- `src/lib/context-usage.ts:9-15` — flat `PRICE_PER_1K` per backend, ignoring
  model tier entirely, and already approximating cache-token pricing with a
  hand-picked `CACHE_READ_WEIGHT = 0.1` heuristic instead of a real rate.

Checked feasibility of pulling model lists live from each provider: only
**Ollama** exposes a real "list models" API (`ollama list`). Claude, Codex, and
Gemini CLIs have no such command — their catalogs are static and versioned
upstream, so we must maintain them ourselves regardless.

## Goals

- One JSON file is the single source of truth for provider identity, model
  catalogs, and per-model pricing (input/output/cached per million tokens).
- Settings > Models, Settings > General's backend picker, Agent Mode's model
  selector, `backend-brand.tsx`, and the cost estimator in `context-usage.ts`
  all read from that one file — no independent literal lists left behind.
- Ollama's model list is fetched live (`ollama list`) instead of hardcoded,
  since it's the one provider that actually supports it.
- CI-enforced guardrail so the canonical id list can never silently drift
  again the way `GeneralSettings.tsx` already has.

## Non-Goals

- **Not wiring Settings model pickers into actual CLI launches.** Confirmed
  during research: `models.claude.id` etc. are currently write-only — nothing
  reads them to select a model for a real launch (no grep hits outside
  `ModelsSettings.tsx` itself). This task fixes *where the data comes from*,
  not this pre-existing functional gap. Flagged, not fixed.
- **Not touching `general.defaultBackend` value semantics, `terminal.*.command`
  presets, or `TerminalPresets.tsx`.** Those are a separate, already-working
  feature (raw shell command customization, legitimately keyed by short names
  including `pi`). Only `GeneralSettings.tsx`'s own hardcoded `BACKENDS` id
  list — which is provably wrong relative to what `BackendStep.tsx` already
  writes into that same setting — gets corrected to use canonical ids.
- **Not building full per-model usage attribution.** `usage-tracker.ts` /
  `BackendTokenUsage` only ever track backend name, never model id — this is
  real plumbing (new DB/type field, capture at record time) beyond a JSON
  catalog. Fast-follow, not blocking. Immediate win: cost estimation moves
  from a flat per-backend guess to each backend's **default model's** real
  3-tier price, using the input/output/cache-read/cache-creation breakdown
  `BackendTokenUsage` already carries but never uses.
- **"pi" is dropped from the model catalog.** Research confirmed it's a
  UI-only stub — no adapter (`sidecar/agent/providers/` has only `claude.ts`),
  no case in `agent-oneshot.ts`, absent from `KnownBackendName`. It stays as
  exactly what it legitimately is: a raw terminal-command preset in
  `TerminalPresets.tsx`, unrelated to AI model selection.
- No live/dynamic listing for Claude, Codex, or Gemini — confirmed infeasible
  (no CLI subcommand exposes it).

## Decisions (resolved during brainstorming)

| Decision | Choice |
|---|---|
| Storage mechanism | Single `providers.json` at repo root, imported directly by both builds (Vite: `resolveJsonModule` already on; Bun: needs the same flag added to `sidecar/tsconfig.json`) — no new IPC round trip for the 4 static-catalog providers. |
| Ollama models | Live via new sidecar RPC `providers.listOllamaModels` (wraps `ollama list`) + Rust passthrough command `list_ollama_models`. Static entry has `models: []`, `dynamic: true`. |
| Canonical ids | The existing 7-id `KnownBackendName` set (`claude-code, codex, gemini, aider, opencode, antigravity, ollama`). `GeneralSettings.tsx` and `ModelsSettings.tsx` both switch to these ids. |
| "pi" | Removed from the catalog entirely; remains only as a `TerminalPresets.tsx` raw-command entry. |
| Pricing granularity | Per model: `inputPerMillion`, `outputPerMillion`, `cachedPerMillion` (USD per 1M tokens). `cacheCreationTokens` priced at `inputPerMillion` (no 4th field). |
| Backends without adapters yet (`aider`, `opencode`, `antigravity`) | Catalog entries exist with `models: []`; hidden from Settings > Models until an adapter ships and populates them. |
| Drift prevention | New test asserts catalog provider ids === `KnownBackendName` exactly, both directions. |

## Architecture

```
providers.json  (repo root — single source of truth)
     │
     ├── src/lib/models/catalog.ts   (frontend typed accessor)
     │      ├── ModelsSettings.tsx        (Settings > Models pickers)
     │      ├── GeneralSettings.tsx       (Settings > General backend picker)
     │      ├── backend-brand.tsx         (label field only; Icon/tagline/installUrl stay local)
     │      ├── settings-defaults.ts      (default model ids computed, not literal)
     │      └── context-usage.ts          (3-tier pricing lookup)
     │
     └── sidecar/providers/catalog.ts   (sidecar typed accessor)
            └── sidecar/agent/providers/claude.ts   (capabilities().models)

Ollama (dynamic, not in the JSON):
  ModelsSettings.tsx → listOllamaModels() [tauri.ts]
    → invoke("list_ollama_models") [Rust, thin passthrough]
      → sidecar "providers.listOllamaModels" [rpc-handlers.ts]
        → Bun.spawn(["ollama", "list"]) → parsed [{id, label}]
```

### 1. `providers.json` (repo root)

```json
{
  "providers": [
    {
      "id": "claude-code",
      "label": "Claude Code",
      "dynamic": false,
      "defaultModel": "claude-opus-4-8",
      "models": [
        { "id": "claude-opus-4-8", "label": "Opus 4.8",
          "pricing": { "inputPerMillion": 15, "outputPerMillion": 75, "cachedPerMillion": 1.5 } },
        { "id": "claude-sonnet-5", "label": "Sonnet 5",
          "pricing": { "inputPerMillion": 3, "outputPerMillion": 15, "cachedPerMillion": 0.3 } },
        { "id": "claude-haiku-4-5-20251001", "label": "Haiku 4.5",
          "pricing": { "inputPerMillion": 0.8, "outputPerMillion": 4, "cachedPerMillion": 0.08 } }
      ]
    },
    { "id": "codex", "label": "Codex", "dynamic": false, "defaultModel": "gpt-5",
      "models": [ /* gpt-5, gpt-5-mini, o4 — same shape */ ] },
    { "id": "gemini", "label": "Gemini CLI", "dynamic": false, "defaultModel": "gemini-2.5-pro",
      "models": [ /* gemini-2.5-pro, gemini-2.5-flash — same shape */ ] },
    { "id": "aider", "label": "Aider", "dynamic": false, "defaultModel": null, "models": [] },
    { "id": "opencode", "label": "OpenCode", "dynamic": false, "defaultModel": null, "models": [] },
    { "id": "antigravity", "label": "Antigravity", "dynamic": false, "defaultModel": null, "models": [] },
    { "id": "ollama", "label": "Ollama", "dynamic": true, "defaultModel": null, "models": [] }
  ]
}
```

Pricing values above match what actually shipped in `providers.json` — real
current public list prices, not placeholders. `label` here is the one used
by `backend-brand.tsx` and Settings; icon/tagline/installUrl stay in
`backend-brand.tsx` since JSON can't carry a React component. Provider order
matches `KNOWN_BACKEND_NAMES` exactly (ollama last).

### 2. `src/lib/models/catalog.ts` (new) + `sidecar/providers/catalog.ts` (new)

Two thin, independently-tested wrapper modules (one per build root, per the
project's existing `ipc.ts`/`types.ts` two-trees convention — unavoidable
given separate package roots, but now both read the *same* data file instead
of each hardcoding their own):

```ts
export interface CatalogModel { id: string; label: string; pricing: { inputPerMillion: number; outputPerMillion: number; cachedPerMillion: number } | null }
export interface CatalogProvider { id: KnownBackendName; label: string; dynamic: boolean; defaultModel: string | null; models: CatalogModel[] }

export function listProviders(): CatalogProvider[]
export function getProvider(id: string): CatalogProvider | undefined
export function getModel(providerId: string, modelId: string): CatalogModel | undefined
export function getDefaultModel(providerId: string): CatalogModel | undefined
export function estimateCost3Tier(providerId: string, usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }): number
```

`sidecar/tsconfig.json` gains `"resolveJsonModule": true` (frontend's
`tsconfig.json:11` already has it).

### 3. Frontend consumers

- **`ModelsSettings.tsx`** — `PROVIDERS` const deleted; renders
  `catalog.listProviders().filter(p => p.models.length > 0 || p.dynamic)`.
  Ollama's row additionally calls `listOllamaModels()` on mount to populate
  its options (loading/empty states: "Ollama not detected" if the command
  fails or returns empty — no crash).
- **`GeneralSettings.tsx`** — local `BACKENDS` const deleted; backend picker
  built from `catalog.listProviders().map(p => ({ value: p.id, label: p.label }))`,
  which now matches what `BackendStep.tsx`/`detectBackends()` actually write.
- **`backend-brand.tsx`** — `label` field per entry replaced by
  `catalog.getProvider(id)?.label`; `Icon`/`tagline`/`installUrl` untouched.
- **`settings-defaults.ts`** — the `models.<id>.id` keys become
  `models.claude-code.id`, `models.codex.id`, `models.gemini.id`,
  `models.ollama.id` (renamed from `claude`, dropped `pi`, added `ollama` —
  it gets a picker too since its models are dynamic, not absent). Literal
  default strings replaced with `catalog.getDefaultModel(id)?.id`, computed
  at module init; Ollama's default is `""` until the user picks one from the
  live list (no static default exists). Pre-existing local settings for the
  old key names simply reset to the new default — acceptable pre-release, no
  migration needed.
- **`ipc.ts`** — `SettingsKey` union's `models.*.id` entries become exactly
  those four (`claude-code/codex/gemini/ollama` — the providers with a
  selectable model list, static or dynamic; `aider/opencode/antigravity` get
  no key until they have models); new `CatalogProvider`/`CatalogModel` types;
  new `listOllamaModels(): Promise<{ id: string; label: string }[]>` in
  `lib/tauri.ts`.
- **`context-usage.ts`** — `PRICE_PER_1K` and `CACHE_READ_WEIGHT` deleted.
  `estimateCost`/`estimateCostFromUsage` delegate to
  `catalog.estimateCost3Tier(backend, usage)`, which prices `inputTokens` at
  `inputPerMillion`, `outputTokens` at `outputPerMillion`,
  `cacheReadTokens` at `cachedPerMillion`, and `cacheCreationTokens` at
  `inputPerMillion` (documented above as the no-4th-field simplification).
  Falls back to `0` if the backend has no default model priced yet
  (`aider`/`opencode`/`antigravity`).

### 4. Sidecar

- **`sidecar/agent/providers/claude.ts`** — local `MODELS` const deleted;
  `capabilities()` returns `catalog.getProvider("claude-code")?.models.map(m => ({ id: m.id, label: m.label }))`
  plus the existing synthetic `{ id: "default", label: "Default" }` entry
  (kept — it's a UI sentinel, not a real model, so it doesn't belong in the
  catalog). `adapterFor()` in `sidecar/agent/provider.ts:38-42` is unchanged —
  it already always returns `claudeAdapter` regardless of backend id (Codex/
  Gemini adapters aren't built yet); this task doesn't change that.
- **`rpc-handlers.ts`** — new `case "providers.listOllamaModels"`, following
  the existing `case "<domain>.<action>"` convention (e.g. `git.branches`,
  `project.destroy`). Spawns `ollama list`, parses the tabular output into
  `{ id, label }[]`, returns `[]` on spawn failure (binary not found / not
  running) rather than throwing.

### 5. Rust (`src-tauri/`)

New thin passthrough command mirroring the existing `project_destroy` pattern:

```rust
#[tauri::command]
pub async fn list_ollama_models(state: State<'_, AppState>) -> Result<Value, String> {
    state.sidecar.request("providers.listOllamaModels", json!({})).await.map_err(|e| e.to_string())
}
```
Registered in `commands/mod.rs` re-exports and `lib.rs`'s `generate_handler!`
list, same as every other sidecar-backed command.

## Data Flow

```
Settings > Models panel
  → catalog.listProviders()  [static, synchronous, no IPC]
  → Ollama row: listOllamaModels() → invoke("list_ollama_models")
      → sidecar "providers.listOllamaModels" → Bun.spawn(["ollama","list"])

Agent Mode Composer model menu
  → sidecar capabilities() → catalog.getProvider("claude-code").models  [static]

Usage panel / context usage estimate
  → estimateCostFromUsage(usage, backend) → catalog.estimateCost3Tier(...)
      → catalog.getDefaultModel(backend)?.pricing
```

## Error Handling

- Unknown provider/model id passed to any accessor → returns `undefined`
  (or `[]` for list functions), never throws. Callers already handle
  optional data (e.g. Settings hides rows with no models; cost estimate
  falls back to `0`).
- `ollama list` failure (binary missing, daemon not running, non-zero exit,
  unparsable output) → sidecar returns `[]`; Settings shows an
  "Ollama not detected" empty state instead of an error.
- Malformed `providers.json` (should never ship, but defensively): the
  accessor's parse step is covered by a schema-shape test in both trees, so
  a bad edit fails CI before it fails a user.

## Testing

Coverage target per `CLAUDE.md`: 100% lines, 95%+ branches.

- **`catalog.test.ts` (both `src/lib/providers/` and `sidecar/providers/`)** —
  schema shape valid; every id present in `KnownBackendName` and vice versa
  (the drift-prevention guardrail); `getDefaultModel` resolves to a model
  actually present in that provider's `models` list; `estimateCost3Tier`
  applies the three rates correctly including the cache-creation → input-rate
  mapping; unknown ids return `undefined`/`[]`/`0`.
- **`ModelsSettings.test.tsx`** — renders one row per catalog provider with
  `models.length > 0 || dynamic`; Ollama row calls `listOllamaModels()` on
  mount and renders its results; empty/failure state renders without
  crashing.
- **`GeneralSettings.test.tsx`** — backend picker options match
  `catalog.listProviders()` ids exactly (replaces the old hardcoded
  assertion).
- **`backend-brand.test.tsx`** — `label` sourced from catalog for every
  `KnownBackendName` entry.
- **`context-usage.test.ts`** — replaces flat-rate assertions with 3-tier
  calculations against known catalog fixture pricing; falls back to `0` for
  unpriced backends.
- **`claude.test.ts` (sidecar adapter)** — `capabilities().models` matches
  `catalog.getProvider("claude-code").models` plus the `default` sentinel.
- **`rpc-handlers.test.ts`** — `providers.listOllamaModels` parses a fixture
  `ollama list` output correctly; returns `[]` on spawn failure.
- **`tauri.ts` / Rust** — `list_ollama_models` wrapper invokes the right
  command name; Rust command passes through to the sidecar unchanged
  (mirrors existing passthrough command tests).

## Out-of-zone touches (require COORDINATOR note in PR)

This spans `src-tauri` (Rust IPC agent zone), `sidecar` (Sidecar logic agent
zone), and multiple `src/` zones (`src/panels/settings/**`, `src/lib/**`,
`src/components/agent/**` indirectly via the sidecar capabilities change).
All changes are additive/substitutive against existing precedents
(`project.destroy`'s RPC/Rust passthrough shape, the `ipc.ts`/`types.ts`
two-trees convention) — no new architectural pattern introduced.
