# Maverick — Agent Guide

You are working on **Maverick**, a native Tauri v2 desktop IDE that orchestrates AI coding CLIs. This file is the source of truth for *how* to write code here. Read it before doing anything.

## Hard Rules (do not violate)

1. **bun, not npm.** Always. `bun install`, `bun run`, `bunx`.
2. **shadcn primitives + Tailwind v4 utility classes only.** No hand-rolled CSS values for color/spacing/radius/font — pull from design tokens in `src/styles/tokens.css`. If a value is missing, add it to tokens first, then use it.
3. **VSCode terminology everywhere.** Never write `Sidebar`, `RightPanel`, `WorkspacePanel`, `CenterPanel`. Use the canonical names below.
4. **TerminalView never imports xterm.js.** Always go through `TerminalRegistry.get()`. Adding a new renderer must require zero changes outside `src/lib/providers/`.
5. **No API keys in Maverick.** Every backend reads credentials from its own CLI config (`~/.claude.json`, `~/.config/codex`, etc.). If you find yourself reading a key, stop.
6. **Keep-alive mount for editor groups.** When you switch workspaces, the inactive group goes `display:none` — never unmount. PTYs must survive tab switches.
7. **Every public function gets a test.** No untested code merges. Coverage target: 100% lines, 95%+ branches. CI fails below thresholds.
8. **Bundle budget is 100MB installed, 200MB RSS at idle.** Before adding a dependency >1MB gzipped, justify in PR description.
9. **No comments explaining WHAT.** Identifiers do that. Only write a comment for non-obvious WHY (invariants, workarounds, perf hacks).
10. **TODO/`todo!()` markers must reference a tracked task.** No silent stubs in production paths.

## Canonical VSCode Terminology

| Concept | Maverick name | Old name (do not use) |
|---|---|---|
| Top draggable bar with traffic lights / breadcrumb | `TitleBar` | — |
| Vertical icon strip on far left (Projects / Git / Kanban / Browser / Settings icons) | `ActivityBar` | — |
| Panel that opens beside ActivityBar (project tree, git log, etc.) | `PrimarySideBar` | `Sidebar` |
| Whole main center region | `EditorArea` | `CenterPanel` |
| One vertical column of editors inside EditorArea | `EditorGroup` | `WorkspacePanel` |
| Tabs at the top of an EditorGroup | `EditorTabs` | `WorkspaceTabBar` |
| Single workspace's content inside a group (Agent or Terminal mode) | `WorkspaceEditor` | — |
| Right-side resizable panel (file tree, diff, run output) | `AuxiliaryBar` | `RightPanel` |
| Bottom horizontal panel (Setup / Run / Terminal tabs) | `Panel` (always capitalised) | `TerminalSubPanel` |
| Bottom 22px strip (backend status, quota, tokens, errors) | `StatusBar` | — |
| Whole UI shell containing all of the above | `Workbench` | `AppBody` |
| App window (Tauri window) | `Window` | — |
| Single PTY inside a Panel split | `TerminalView` | `TerminalPane` |
| Binary split tree of TerminalViews | `SplitGrid` | `SplitPane` |
| `⌘⇧P` overlay | `CommandPalette` | — |
| `⌘P` overlay | `QuickOpen` | — |
| `⌘⇧Space` preset overlay | `PresetLauncher` | — |

CSS class names follow `.mv-<lowercase-component>` convention: `.mv-activitybar`, `.mv-editorgroup`, `.mv-statusbar`. Never use BEM `__` modifiers — use Tailwind utilities for variants.

## Layer Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│  Window (Tauri v2)                                          │
│  ┌─────────────────────────┐    ┌─────────────────────────┐ │
│  │  WebView (React)        │    │  Rust Core              │ │
│  │  src/                   │◄──►│  src-tauri/src/         │ │
│  └─────────────────────────┘    └────────┬────────────────┘ │
│                                          │ stdio JSON-RPC   │
│                                          ▼                  │
│                              ┌───────────────────────┐      │
│                              │  Bun Sidecar          │      │
│                              │  sidecar/             │      │
│                              └───────┬───────────────┘      │
│                                      │ Bun.spawn / node-pty │
│                                      ▼                      │
│              claude  codex  gemini  aider  ollama           │
└─────────────────────────────────────────────────────────────┘
```

**Rules:**

- React never reaches into `sidecar/` directly. It calls Tauri commands.
- Rust never parses YAML, never touches SQLite, never spawns CLIs. It is a JSON-RPC pass-through with event forwarding.
- Bun sidecar owns: PTYs, git worktrees, SQLite, config parsing, skill interpolation, MCP processes.
- All cross-layer types live in two places: `src/lib/ipc.ts` (React) and `sidecar/types.ts` (Bun). When one changes, the other must change. Rust uses `serde_json::Value` to stay decoupled.

## File Ownership (subagent boundaries)

Subagents must respect these zones to avoid edit conflicts:

| Zone | Owner |
|---|---|
| `src-tauri/**` | Rust IPC agent |
| `sidecar/**` | Sidecar logic agent |
| `src/components/workbench/**`, `src/components/activitybar/**`, `src/components/statusbar/**` | Frontend shell agent |
| `src/components/editor/**`, `src/lib/providers/**` | Editor/Terminal agent |
| `src/panels/git/**`, `src/panels/kanban/**`, etc. | Panel agent (one per panel) |
| `src/styles/**`, `src/components/ui/**` (shadcn) | Design system agent |
| `**/*.test.ts`, `**/*.test.tsx`, `**/*_test.rs` | Test agent (may touch any zone) |
| `CLAUDE.md`, `PRD.md`, `SYSTEM-DESIGN.md`, root configs | Coordinator only |

If you need to touch outside your zone, leave a `// COORDINATOR: <why>` comment and surface it in your final report.

## Design System Rules

**Tokens live in `src/styles/tokens.css`.** They drive Tailwind via the v4 `@theme` block in `src/styles/globals.css`.

Use ONLY these for styling:

- **Color:** `bg-background`, `text-foreground`, `bg-muted`, `text-muted-foreground`, `bg-card`, `border-border`, `bg-accent`, `text-destructive` etc. — all map to CSS custom properties.
- **Spacing:** `gap-1` through `gap-8`, `p-1` through `p-8`. The scale is 4px-based. Don't use `p-[13px]` etc.
- **Radius:** `rounded-sm`, `rounded`, `rounded-md`, `rounded-lg`. Defined in tokens.
- **Font:** `font-mono` everywhere (Geist Mono is the only font).
- **Z-index:** Use the named layers `z-base`, `z-overlay`, `z-modal`, `z-toast` (defined in Tailwind config).
- **Shadows:** `shadow-sm`, `shadow`, `shadow-md`. Don't roll custom shadows.

**Pure black theme (v0.1 default):**

- `--background: 0 0% 0%` (true black)
- `--foreground: 0 0% 96%`
- `--muted: 0 0% 7%`
- `--border: 0 0% 14%`
- `--accent: 263 70% 60%` (purple)

Theme switching swaps the CSS custom property values via `data-theme="<name>"` on `<html>`. Components don't know which theme is active — they just use `bg-background` etc.

**shadcn primitives are in `src/components/ui/`** — never edit these directly except to retheme via Tailwind classes. They are generated and re-runnable via `bunx shadcn add <name>`.

## Animation Rules

- Use Framer Motion's `<motion.div>` for any state-change animation (panel open/close, tab switch, modal in/out).
- Spring presets: `{ type: "spring", stiffness: 380, damping: 30 }` (snappy), `{ stiffness: 200, damping: 25 }` (smooth).
- Duration animations: `duration: 0.15s` for hovers, `0.2s` for fades, `0.3s` for panel slides.
- Honor `prefers-reduced-motion`. The `useReducedMotion()` hook from Framer Motion handles this — wrap your motion props in a check.
- Never animate `width`/`height` directly — use `scale` or `transform` for 60fps.

## Performance Rules

- **<10ms workspace switch.** Achieve via keep-alive mount + `display:none`. Use `content-visibility: auto` on inactive groups to avoid layout cost.
- **<16ms terminal write→paint.** xterm.js's canvas renderer is the default, not the DOM renderer.
- **Lazy-load heavy panels.** `KanbanBoard`, `BrowserPanel`, `FilePreviewPanel`, `SettingsPanel` are `lazy()` imports. Activity bar buttons trigger the import.
- **Virtualise lists >50 items.** Use `react-window` for commit logs, message lists, kanban columns over 50 cards.
- **No layout thrash on PTY data.** Buffer xterm writes in a 16ms RAF window if data arrives faster than 60fps.

## Testing Requirements

- **Vitest** is the unit runner for React + TS. Config in `vitest.config.ts`. Environment: `jsdom`.
- **@testing-library/react** for component tests. Query by accessible role first, text second, testid last.
- **MSW** mocks `@tauri-apps/api/core` `invoke()`. Setup in `src/test/setup.ts`.
- **Bun test** for sidecar (`bun test sidecar/`). Mock `Bun.spawn` via a fake subprocess factory.
- **cargo test --workspace** for Rust. Mock the sidecar process by piping a fixture JSON-RPC stream.
- **Playwright** (`bunx playwright`) for end-to-end through the actual Tauri app — only the golden path, runs in CI nightly.

**Coverage thresholds (CI-enforced):**

```
lines: 100
branches: 95
functions: 100
statements: 100
```

Every PR must pass `bun run test:coverage`.

## File-Naming Conventions

- React components: `PascalCase.tsx` (one component per file).
- Hooks: `useThing.ts`.
- Plain utilities: `kebab-case.ts`.
- shadcn primitives: `kebab-case.tsx` (matches shadcn convention).
- Test files: `Thing.test.tsx` sibling to source.
- Rust modules: `snake_case.rs`.

## When You're Stuck

1. Read this file again — the rule you need is probably here.
2. Read `PRD.md` for what to build.
3. Read `SYSTEM-DESIGN.md` for how it fits together.
4. Search the existing code (`grep`) for prior art. Match it.
5. Surface the question in your final report, don't guess at conventions.

## What "Done" Means

A task is **done** when:

- Code compiles (`bun run build` + `cargo check`).
- Tests pass (`bun run test:coverage` + `cargo test`).
- Coverage thresholds met.
- No `any` types, no `todo!()` in execution paths reachable from a Tauri command.
- The feature actually works when you launch `bun run tauri dev` and try it.

If you cannot get to "done", report what blocks you. Do not mark complete.

---

*Last updated: 2026-05-21 — Malhar Ujawane*
