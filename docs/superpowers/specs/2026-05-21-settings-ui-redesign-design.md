# Settings UI Redesign — Design Doc

**Status:** Draft → ready for plan
**Author:** Malhar Ujawane (with Claude)
**Date:** 2026-05-21
**Scope:** `src/panels/settings/**`, plus three new tokens and two new shadcn primitives.

## Problem

The current Settings panel (`src/panels/settings/SettingsPanel.tsx`) is visually flat and unstructured:

- 12-item flat nav with no grouping. Past ~8 items, scanning is slow.
- `Row` is a bare two-column grid; no helper text, no description of what each setting does.
- Toggles are rendered as a `Button` with the literal text "On" / "Off" — no Switch primitive exists.
- No search, no footer, no version info, no escape-hatch to edit JSON directly.
- Every section reimplements its own `Row` helper; no shared primitives.

Reference state is Warp's settings modal: categorised nav with search, grouped content cards with title + helper text + control, gradient on the selected control, and a footer with raw-config link and version info.

## Goals

1. Match Warp's polish without losing Maverick's purple identity.
2. Introduce shared `Settings*` primitives so adding a new section is a 30-line file, not a 100-line file.
3. Give every setting a title, helper text, and a properly-typed control.
4. Wire optimistic save → debounced persist → footer status indicator.

## Non-goals

- Wiring real persistence in the Bun sidecar (`settings_write` / `settings_read_all` Tauri commands). The store ships with in-memory defaults and a `TODO` referencing a follow-up. Today's panel doesn't persist either; we're not regressing.
- Adding new settings that don't already exist.
- Multi-window settings sync.

## Architecture

### File layout

```
src/panels/settings/
├── SettingsPanel.tsx              Dialog shell. Owns selected-section state.
├── SettingsNavRail.tsx            Left nav: search, groups, items, kbd nav.
├── SettingsHeader.tsx             Section title + helper + optional badge.
├── SettingsFooter.tsx             "Open settings file" + sync status.
├── primitives/
│   ├── SettingsGroup.tsx          Titled card group container.
│   ├── SettingsRow.tsx            Stacked: title, helper, control slot.
│   ├── SettingsToggle.tsx         Wraps shadcn Switch with Maverick styling.
│   ├── SettingsSelect.tsx         Wraps shadcn Select with Maverick styling.
│   └── SettingsSearchInput.tsx    Input with leading search icon.
└── sections/                      Each section rewritten against primitives.
    ├── GeneralSettings.tsx
    ├── ModelsSettings.tsx
    ├── ProvidersSettings.tsx      (extracted from inline in SettingsPanel)
    ├── AppearanceSettings.tsx
    ├── NotificationsSettings.tsx
    ├── KeybindingsSettings.tsx
    ├── GitSettings.tsx
    ├── MCPsSettings.tsx
    ├── AdvancedSettings.tsx
    ├── AccountSettings.tsx
    ├── TerminalPresets.tsx
    └── RepositorySettings.tsx

src/lib/stores/settings.ts         New Zustand store + useSettings hook.
src/components/ui/switch.tsx       New shadcn primitive (bunx shadcn add).
src/components/ui/select.tsx       New shadcn primitive (bunx shadcn add).
src/styles/tokens.css              +3 tokens (see below).
```

### Component boundaries

| Unit                  | Purpose                                | Interface                                                                          | Depends on                                |
| --------------------- | -------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------- |
| `SettingsPanel`       | Dialog shell, routing                  | `open?, onOpenChange?, onClose?`                                                   | NavRail, Header, Footer, sections         |
| `SettingsNavRail`     | Nav + search                           | `section, onSelect(id), query, onQueryChange`                                      | `cmdk`, lucide icons                      |
| `SettingsHeader`      | Section title/desc                     | `title, description?, badge?`                                                      | —                                         |
| `SettingsFooter`      | Open-file + status                     | `onOpenFile(), status: 'idle' \| 'saving' \| 'saved' \| 'error'`                   | StatusDot                                 |
| `SettingsGroup`       | Card container                         | `title?, description?, children`                                                   | —                                         |
| `SettingsRow`         | Single setting                         | `title, description?, control: ReactNode`                                          | —                                         |
| `SettingsToggle`      | On/off switch                          | `checked, onCheckedChange, disabled?`                                              | shadcn `Switch`                           |
| `SettingsSelect`      | Dropdown                               | `value, onValueChange, options: {value, label}[]`                                  | shadcn `Select`                           |
| `SettingsSearchInput` | Nav search                             | `value, onChange, placeholder?`                                                    | shadcn `Input`, Search icon               |
| `useSettings`         | Read/write any setting                 | `<K extends SettingsKey>(key: K) => [value, (v) => void]`                          | Zustand store                             |

Each section reads/writes only via `useSettings`. They never reach into the store directly. This lets us swap the persistence layer later without touching sections.

### Data flow

```
SettingsRow control onChange(value)
    │
    ▼
useSettings setter
    │  (Zustand store updates synchronously — optimistic UI)
    ▼
Debounced 250ms → invoke("settings_write", { key, value })
    │
    ▼
Bun sidecar persists to ~/.config/maverick/settings.json     [future]
    │
    ▼
Footer status: "saving…" → "Saved · just now" → fades to "All changes saved"
```

On error: rollback in store, toast `Failed to save · retry`, footer flips to `Save failed`.

Today's stub: `invoke` returns `{ ok: true }` without round-tripping the sidecar; the store keeps the value in memory. A single `// TODO: wire to sidecar settings_write` comment marks the call site.

### Cross-layer contracts

Add to `src/lib/ipc.ts`:

```ts
export type SettingsKey =
  | "general.defaultBackend"
  | "general.defaultBranch"
  | "general.namingScheme"
  | "general.restoreSession"
  | "appearance.theme"
  | "appearance.uiFontSize"
  | "appearance.terminalFontSize"
  | "appearance.ligatures"
  | "appearance.animations"
  | "account.licenseKey"
  | "account.updateChannel"
  // …one per concrete setting, no string literals in components
  ;

export type SettingsValue =
  | string
  | number
  | boolean
  | { kind: "channel"; value: "stable" | "beta" };

export interface SettingsWriteRequest { key: SettingsKey; value: SettingsValue; }
export type SettingsWriteResponse =
  | { ok: true }
  | { ok: false; error: string };
```

Rust IPC and `sidecar/types.ts` get the same shapes verbatim. Rust stays pass-through (`serde_json::Value`).

## Visual language

### Modal shell

| Property            | Value                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| Width               | `min(960px, 92vw)`                                                          |
| Height              | `min(680px, 86vh)`                                                          |
| Background          | `bg-popover/95 backdrop-blur-xl`                                            |
| Border              | inset 1px `--border-glass-strong`                                           |
| Shadow              | new token `--shadow-modal: 0 24px 64px -12px rgb(0 0 0 / 0.5)`              |
| Outer radius        | `--radius-xl` (12px)                                                        |
| Inner card radius   | `--radius-lg` (10px)                                                        |
| Title-row hairline  | 1px gradient `from-transparent via-accent/30 to-transparent` under title    |

### NavRail (220px)

- `bg-card/40`, no visible right border (relies on content area being lighter).
- Search input pinned at top: `bg-transparent border-border/50`, leading Search icon, `text-xs`.
- Group headers: `text-[10px] uppercase tracking-[0.08em] font-medium text-muted-foreground/70`, 8px top / 4px bottom padding.
- Nav items: 28px tall, `text-xs`, 8px icon→label gap, hover `bg-muted/40`, selected `bg-accent/15` with 2px `border-l-accent`.
- Selected indicator animates between items via Framer `layoutId="nav-indicator"`.

### ContentArea

- Padding `px-8 py-6`, scrollable.
- `SettingsHeader`: `h2` at `text-base font-semibold`, helper `text-xs text-muted-foreground max-w-prose`.
- `SettingsGroup`: `bg-card/40 border border-border/60 rounded-lg p-5 space-y-4`.
- `SettingsRow`: title `text-sm font-medium`, helper `text-xs text-muted-foreground`, 8px to control.
- Rows inside a group separated by `divide-y divide-border/40`.

### Controls

- **Switch (`SettingsToggle`)**: 32×18px track. Off: `bg-muted`. On: gradient `from-accent to-accent/80`. Thumb 14×14, spring `(380, 30)`.
- **Select (`SettingsSelect`)**: `bg-muted/50 hover:bg-muted/70 border-border/60`, chevron.
- **Input**: existing `Input` + focus ring `ring-2 ring-accent/40`.
- **Slider** (font sizes): track `bg-muted`, filled `bg-accent`, thumb `bg-foreground border-2 border-accent`. Value chip on the right.

### Footer (44px)

- `border-t border-border/40 bg-card/40`.
- Left: ghost `Button` "Open settings file" with `Code2` icon, opens JSON in EditorArea (or external editor as fallback).
- Right: `StatusDot` + "Saved · just now". Fades to "All changes saved" after 800ms idle.

### Animations

| Event              | Transition                                            |
| ------------------ | ----------------------------------------------------- |
| Modal open         | `scale [0.96, 1] opacity [0, 1]`, spring (280, 26)    |
| Section change     | fade 100ms out, 150ms in, 4px slide-up                |
| Search filter      | nav items with Framer `layout`                        |
| Toggle             | spring (380, 30), track cross-fade 150ms              |

Wrapped in `useReducedMotion()` — all collapse to instant when user prefers reduced motion.

### Tokens added to `src/styles/tokens.css`

```css
--shadow-modal: 0 24px 64px -12px rgb(0 0 0 / 0.5);
--settings-nav-width: 220px;
--settings-modal-max-w: 960px;
```

Mapped into Tailwind v4 `@theme` in `globals.css` as `shadow-modal`, `w-settings-nav`, `max-w-settings-modal`.

## Nav structure

```
Search…                                       ⌘F

WORKSPACE
  General
  Repositories
  Git

AI
  Models
  Providers
  MCPs

EDITOR
  Appearance
  Keybindings
  Terminal

SYSTEM
  Notifications
  Advanced
  Account
```

Groups defined as a constant `NAV_GROUPS: { id: string; label: string; items: NavItem[] }[]` in `SettingsNavRail.tsx`. Order is intentional — most-used groups first.

Search filters items in place. When a group has zero matching items, its header hides. Selected item's group always remains visible regardless of filter (so the user keeps orientation).

Keyboard: `↑`/`↓` move within visible items skipping group headers, `Enter` selects, `⌘F` focuses the search input. Existing `⌘,` opens the dialog.

URL state: section persisted as `?settings=<id>` query param so a re-open returns to the same section within a session.

## Testing

Vitest + @testing-library/react. CI thresholds: 100% lines, 95% branches.

**New tests**

- `SettingsNavRail.test.tsx`
  - Renders all groups and items.
  - Search filters items by label substring (case-insensitive).
  - Group header hides when all its items filtered out.
  - Selected group header always visible regardless of query.
  - Click item → calls `onSelect(id)`.
  - `↑`/`↓` cycle through visible items skipping headers.
  - `⌘F` focuses search input.
  - `prefers-reduced-motion` disables the `layoutId` indicator animation.
- `SettingsRow.test.tsx`
  - Renders title, description, control slot.
  - Helper text linked via `aria-describedby` matching the control's `aria-describedby`.
- `SettingsGroup.test.tsx`
  - Renders optional title/description and children.
  - Children are separated by visible divider when more than one child.
- `SettingsToggle.test.tsx`
  - Click toggles checked.
  - Space key toggles.
  - Disabled prevents change.
  - Fires `onCheckedChange` exactly once per change.
- `SettingsSelect.test.tsx`
  - Opens menu on click, selects on item click, fires `onValueChange`.
- `useSettings.test.ts`
  - Returns default on first read.
  - Setter updates store synchronously (optimistic).
  - Persist call debounced 250ms; multiple sets within window coalesce to one `invoke`.
  - Error response rolls back to previous value and emits toast.
  - Store rehydrates from `settings_read_all` on mount.
- `SettingsFooter.test.tsx`
  - Click "Open settings file" → fires `onOpenFile()`.
  - Status `saving` shows spinner + "Saving…"; `saved` shows green dot + "Saved · just now"; `error` shows red dot + "Save failed · retry".
  - "Saved · just now" auto-replaces with "All changes saved" after 800ms.

**Rewritten tests**

Existing section tests (`GeneralSettings.test.tsx` etc.) — assertions remain behavioural (`toBeChecked`, `toHaveValue`, `screen.getByRole("switch", { name: /restore/i })`) so the visual rewrite doesn't churn them. The selectors switch from `data-testid` button clicks to `getByRole`.

**Integration**

`SettingsPanel.test.tsx`
- Dialog opens / closes via prop, ESC, overlay click.
- Initial section is `general`.
- Section change updates `?settings=` URL param.
- Re-mounting with `?settings=appearance` opens on Appearance.
- DialogTitle reflects the current section name (no longer sr-only).
- Focus trapped inside dialog; Tab from last → first.

**a11y**
- Every control has an accessible name (label `htmlFor` for inputs, `aria-label` for toggles, `aria-describedby` for helpers).
- Color contrast meets WCAG AA in both pure-black and the default purple theme.
- Reduce-motion verified manually plus one snapshot test on the modal entry animation.

**Manual smoke**
- `bun run tauri dev` → ⌘, → tab through every section → toggle every Switch → search "term" → open settings file → close & reopen, lands on the same section.
- Light theme (Solarized) sanity check: gradient hairline still visible, glass effect doesn't get washed out.

## Build order

1. **Tokens + shadcn primitives**
   - Add 3 tokens to `tokens.css`, map into Tailwind `@theme` in `globals.css`.
   - `bunx shadcn add switch select` (re-themed via Tailwind only, no edits inside `src/components/ui/`).
2. **Store + IPC types**
   - `src/lib/stores/settings.ts` — Zustand store, typed `SettingsKey` enum, `useSettings` hook, 250ms debounced `invoke`.
   - Add `SettingsKey`, `SettingsValue`, `SettingsWriteRequest`, `SettingsWriteResponse` to `src/lib/ipc.ts` and mirror in `sidecar/types.ts`.
3. **Settings primitives** (in `src/panels/settings/primitives/`)
   - `SettingsGroup`, `SettingsRow`, `SettingsToggle`, `SettingsSelect`, `SettingsSearchInput`.
   - Tests for each.
4. **Shell components**
   - `SettingsNavRail` (with search + kbd nav + animated indicator).
   - `SettingsHeader`.
   - `SettingsFooter` (with status indicator + open-file action).
   - Tests for each.
5. **`SettingsPanel` rewrite**
   - Compose the new shell with animations and URL persistence.
   - Update `SettingsPanel.test.tsx`.
6. **Section rewrites**
   - One section at a time: General → Appearance → Account → Models → Providers → Notifications → Keybindings → Git → MCPs → Advanced → Terminal → Repositories.
   - Each rewrite is a single PR-able commit; tests follow source.
7. **Coverage + smoke**
   - `bun run test:coverage` must stay green at thresholds.
   - Manual smoke as above. Document a 30-second video in PR.

## Risks & mitigations

| Risk                                                            | Mitigation                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| In-memory persistence is silently lost on relaunch              | Footer status reads "Saved (memory only — restart resets)" until sidecar shipped. Single visible warning > silent loss. |
| `backdrop-blur-xl` over `bg-popover/95` may hit GPU on low-end iGPUs | Wrap with `@supports (backdrop-filter)`; fall back to `bg-popover` solid.   |
| `layoutId` animation can stutter if many items reflow during search | Memoise filtered list and skip `layoutId` while query length < 1 char (which is the common case). |
| Section rewrites land out-of-order, mixing old & new patterns   | Build the primitives first; sections rewrite is mechanical. Order in step 6 is hard sequence, not parallel. |

## Open questions

None blocking. Sidecar persistence and multi-window sync are tracked as follow-ups, not blockers.
