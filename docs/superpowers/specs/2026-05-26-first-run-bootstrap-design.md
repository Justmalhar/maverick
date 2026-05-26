# First-Run Bootstrap & Permission Wizard — Design

**Date:** 2026-05-26
**Author:** Malhar Ujawane (brainstormed with Claude)
**Status:** Design — awaiting implementation plan
**Touches:** Phase 0 + Phase 15 (Notifications) from `todo.md`

---

## 1. Goal & Scope

On first launch, Maverick:

- **(a)** creates the `~/.maverick/` user-config tree and the OS app data dir,
- **(b)** detects which AI CLI backends are present on `$PATH`,
- **(c)** requests OS notification permission via `tauri-plugin-notification`,
- **(d)** runs a skippable 4-step wizard so the user can choose a theme and default backend.

The wizard is re-runnable from `Settings → General → Run setup wizard`. Subsequent launches do nothing visible — bootstrap is idempotent.

**Out of scope** (deferred to later specs):

- Notification bell UI in StatusBar (Phase 15 — blocked-by this spec landing the plugin)
- `MAVERICK.md` instruction-file injection
- Telemetry opt-in
- `~/.maverick/themes/` hot-reload watcher
- Multi-version `schemaVersion` migrations

---

## 2. Filesystem Layout

### Created on every launch (idempotent)

```
~/.maverick/                       (user config — visible, hand-editable)
├── settings.json                  ← global app settings (theme, defaultBackend, firstRunCompletedAt, wizardVersion)
├── themes/                        ← custom .maverick-theme.json drop-in dir
├── GLOBAL.md                      ← cross-repo instructions (seeded with commented welcome)
└── attachments/                   ← reserved for PRD §5.24 auto-convert (created lazily by AttachmentStore)
```

| OS | App data dir (for SQLite + logs) |
|---|---|
| macOS | `~/Library/Application Support/maverick/` |
| Linux | `~/.local/share/maverick/` |
| Windows | `%APPDATA%\maverick\` |

The SQLite DB already lives there via `sidecar/sqlite-store.ts::defaultDbPath()`. The bootstrap ensures that parent directory exists *before* the sidecar starts.

### Lazy (created on first write by their owner)

- `~/.maverick/presets.yaml` → `PresetLauncher.saveCurrent` when user saves first global preset
- `~/.maverick/automations.yaml` → `AutomationsPanel` save-global flow (future)

### `~/.maverick/settings.json` seed schema

```jsonc
{
  "schemaVersion": 1,
  "wizardVersion": 1,
  "firstRunCompletedAt": null,    // unix-ms when user clicked "Get started"; null until then
  "theme": "maverick-dark",
  "defaultBackend": null,          // 'claude-code' | 'codex' | 'gemini' | 'aider' | 'ollama' | null
  "notificationsRequestedAt": null
}
```

### `~/.maverick/GLOBAL.md` seed content

```markdown
<!-- Maverick global instructions.
     This file is auto-prepended to every prompt sent to AI backends across ALL repos,
     unless overridden by a project-local MAVERICK.md, CLAUDE.md, or AGENTS.md.
     Edit freely; comments are stripped before injection. -->
```

---

## 3. First-Run Detection

**Sentinel:** `~/.maverick/settings.json::firstRunCompletedAt` (timestamp or `null`) + `wizardVersion` (int).

**Rules:**

| State | Behaviour |
|---|---|
| `firstRunCompletedAt === null` | Show wizard from step 1 |
| `firstRunCompletedAt !== null && wizardVersion < CURRENT_WIZARD_VERSION` | Show only steps added since stored `wizardVersion` (lightweight "what's new") |
| `firstRunCompletedAt !== null && wizardVersion === CURRENT_WIZARD_VERSION` | No wizard |

**Re-trigger:** `Settings → General → Run setup wizard` calls `reset_first_run()` which sets `firstRunCompletedAt = null`. Settings → Notifications keeps a "Request notification permission" button that calls only `request_notification_permission()` directly.

---

## 4. Architecture & Components

### 4.1 Rust changes (`src-tauri/src/`)

| File | Status | Purpose |
|---|---|---|
| `bootstrap.rs` | **new** | `MaverickPaths`, `ensure_dirs()`, `read_settings()`, `write_settings()`, `seed_global_md()`. Pure FS — no Tauri-API deps so it's unit-testable with `tempdir`. |
| `backend_detector.rs` | **new** | `detect_backends()` returns `Vec<DetectedBackend>` by scanning `$PATH`. Trait-injected `PathLooker` for tests. |
| `state.rs` | modified | Adds `paths: MaverickPaths` field to `AppState`. |
| `commands/bootstrap.rs` | **new** | Tauri commands listed in §4.3. |
| `commands/mod.rs` | modified | `pub mod bootstrap;` + re-export. |
| `lib.rs` | modified | Calls `bootstrap::ensure_dirs(handle)` at the top of `setup` (before sidecar spawn). Adds `tauri_plugin_notification::init()`. Registers the 6 new commands. |
| `Cargo.toml` | modified | Adds `tauri-plugin-notification = "2"`, `which = "6"`, dev-dep `tempfile = "3"`. |
| `capabilities/default.json` | modified | Adds `notification:default`, `notification:allow-request-permission`, `notification:allow-is-permission-granted`. |

### 4.2 React changes (`src/`)

| File | Status | Purpose |
|---|---|---|
| `panels/firstrun/FirstRunWizard.tsx` | **new** | Full-screen overlay (`z-overlay`) with step indicator, content slot, Skip/Back/Continue footer. Uses Framer Motion fade-in. |
| `panels/firstrun/steps/WelcomeStep.tsx` | **new** | Step 1 — paths created, copy-to-clipboard. |
| `panels/firstrun/steps/PermissionsStep.tsx` | **new** | Step 2 — notification permission. |
| `panels/firstrun/steps/ThemeStep.tsx` | **new** | Step 3 — theme grid (compact variant of `AppearanceSettings`). |
| `panels/firstrun/steps/BackendStep.tsx` | **new** | Step 4 — backend detection results + default picker. |
| `hooks/useFirstRun.ts` | **new** | `useFirstRun() → { open, status, paths, advance, complete, skip, reset }`. |
| `lib/tauri.ts` | modified | Typed wrappers for the 6 new commands. |
| `lib/ipc.ts` | modified | `MaverickSettings`, `DetectedBackend`, `BootstrapStatus` types. |
| `components/workbench/Workbench.tsx` | modified | Lazy-mount `FirstRunWizard` when `useFirstRun().open === true`. |
| `panels/settings/sections/GeneralSettings.tsx` | modified | Adds "Run setup wizard" row that calls `reset_first_run()`. |
| `panels/settings/sections/NotificationsSettings.tsx` | modified | Adds "Request notification permission" button (re-callable). |
| `package.json` | modified | Adds `@tauri-apps/plugin-notification`. |

### 4.3 Tauri Command Contract

All commands return Promises; errors surface as rejected promises with string messages.

```typescript
// Returns current state. Always succeeds (returns degraded mode on FS errors).
bootstrap_status(): Promise<{
  ok: boolean
  error?: string
  firstRun: boolean
  wizardVersion: number
  currentWizardVersion: number
  paths: {
    configRoot: string   // ~/.maverick
    dbPath: string       // OS-specific
    logsDir: string      // OS-specific
  }
  settings: MaverickSettings
  notificationPermission: 'granted' | 'denied' | 'default' | 'unavailable'
}>

// Partial-update settings.json atomically (write-tmp-rename).
bootstrap_update_settings(
  patch: Partial<MaverickSettings>
): Promise<MaverickSettings>

// Marks firstRunCompletedAt = Date.now() and stores currentWizardVersion.
bootstrap_complete(): Promise<{ firstRunCompletedAt: number }>

// Probes PATH for each known CLI. 2s timeout per backend.
detect_backends(): Promise<Array<{
  name: 'claude-code' | 'codex' | 'gemini' | 'aider' | 'ollama'
  command: string
  installed: boolean
  path: string | null
  version: string | null
}>>

// Calls tauri-plugin-notification. Returns OS-reported state.
request_notification_permission(): Promise<
  'granted' | 'denied' | 'default' | 'unavailable'
>

// Sets firstRunCompletedAt = null. UI then re-shows wizard.
reset_first_run(): Promise<void>
```

### 4.4 Data Flow

```
App launch
  ↓
Rust setup hook
  → bootstrap::ensure_dirs()        // creates ~/.maverick + OS app data dir
  → bootstrap::read_settings()      // seeds settings.json if missing
  → state.manage(AppState { paths, sidecar })
  → spawn sidecar (existing flow)
  ↓
React mount
  → useFirstRun() calls bootstrap_status()
  → if firstRun === true: <FirstRunWizard />
  ↓
Wizard step 2 mount
  → request_notification_permission()  // only on user click
  ↓
Wizard step 4 mount
  → detect_backends()                  // 2s timeout per backend
  ↓
"Get started" click
  → bootstrap_complete()
  → useFirstRun.open = false → unmount
```

---

## 5. Wizard UX Flow

```
┌─ FirstRunWizard (full-screen overlay) ────────────────────────────┐
│                                                                   │
│   ●───○───○───○        Step 1 / 4                                 │
│   Welcome  Perms  Theme  Backend                                  │
│                                                                   │
│   [Step content area, ~600px max width, centred]                  │
│                                                                   │
│              [Skip]?  [Back]?  [Continue | Get started]           │
└───────────────────────────────────────────────────────────────────┘
```

**Footer button rules:**
- `Skip` — visible on steps 2, 3, 4 only. Advances without writing the step's choice. Hidden on step 1.
- `Back` — visible on steps 2, 3, 4 only. Returns to previous step without unwinding choices. Hidden on step 1.
- Primary button — `Continue` on steps 1–3, `Get started` on step 4. Always visible. On step 4 calls `bootstrap_complete()`.

### Step 1 — Welcome (no Skip)
- "Welcome to Maverick"
- Bullet list of created paths:
  - `~/.maverick/`
  - `~/.maverick/themes/`
  - `~/.maverick/GLOBAL.md`
  - OS app data dir
- Each path is click-to-copy (toast: "Copied").

### Step 2 — Permissions
- Card: "Allow Maverick to send notifications when agents finish, wait for input, or hit quota limits."
- Current state pill: `not yet asked` / `granted` / `denied` / `unavailable`
- `[Allow notifications]` calls `request_notification_permission()`.
- If denied: one-line hint pointing to System Settings → Notifications → Maverick.
- `[Skip for now]` advances without asking.
- If `notificationPermission === 'unavailable'` (no plugin / unsupported OS), card auto-shows "Notifications unavailable on this platform" and auto-advances after 800ms.

### Step 3 — Theme
- Grid of 14 themes (re-uses `AppearanceSettings` theme cards in compact variant).
- Click a card → live-applies via `ThemeProvider.setTheme` + persists via `bootstrap_update_settings({ theme })`.
- `[Skip]` keeps Maverick Dark.

### Step 4 — Default backend
- Auto-runs `detect_backends()` on mount.
- One row per known backend: name, version (or "not found"), install hint link.
- Radio: pick default (or "No default — ask each time").
- `[Get started]` calls `bootstrap_complete()`.

---

## 6. Permissions Model

Today we have one OS permission to gather (notifications). The framework is extensible.

### Tauri capability additions

```json
// src-tauri/capabilities/default.json (additions only)
{
  "permissions": [
    "notification:default",
    "notification:allow-request-permission",
    "notification:allow-is-permission-granted"
  ]
}
```

### Permission lifecycle

1. **Probe** — `isPermissionGranted()` at wizard step 2 mount (silent).
2. **Request** — `requestPermission()` only when user clicks Allow. Never silent / auto.
3. **Persist** — OS owns the state; we re-probe at each launch and surface in `Settings → Notifications` + `StatusBar`.
4. **Re-request** — If denied, never auto-re-ask. `Settings → Notifications` shows: "Notifications are denied. Open System Settings → Notifications → Maverick to enable."

### What we do NOT ask for (intentional)

| Permission | Reason for skipping |
|---|---|
| Accessibility / Screen Recording | Not needed for v0.1 features |
| Full Disk Access | `~` is not protected; per-repo paths are user-picked via Tauri dialog |
| Keychain | `CLAUDE.md` hard rule #5 — no API keys ever |
| AppleEvents | Not needed |
| Camera / Microphone | Not needed |

If a future feature needs a new permission, we add a new step under `PermissionsStep` rather than a new top-level wizard.

---

## 7. Error Handling

| Failure | Behaviour |
|---|---|
| `mkdir ~/.maverick/` fails | Log via `tauri-plugin-log`. `bootstrap_status` returns `{ ok: false, error }`. UI shows non-blocking banner. App still loads. Wizard does not open. |
| `settings.json` exists but corrupt JSON | Rename to `settings.json.corrupt-<unix>`, re-seed defaults, log the new path. |
| `wizardVersion` from disk > `CURRENT_WIZARD_VERSION` (user downgraded) | Treat as completed; no wizard. Log warning. |
| Notification plugin missing or unsupported OS | Step 2 shows "Notifications unavailable" and auto-advances. |
| Backend detection timeout (per-backend) | 2s timeout. Timed-out entries show as `installed: false`. |
| User force-closes during wizard | Sentinel remains `null`. Wizard re-opens next launch from step 1. |

**Hard fails:** None. The bootstrap must degrade — the app must be usable even if `~/.maverick/` is unreachable, matching the existing `Sidecar::placeholder()` precedent in `lib.rs`.

---

## 8. Testing Strategy

### Rust unit tests (`src-tauri/src/bootstrap.rs` + `backend_detector.rs` `#[cfg(test)]`)

- `ensure_dirs` creates the tree under a `tempfile::tempdir` `HOME`
- `ensure_dirs` is idempotent (called twice → no error)
- `read_settings` on missing file returns defaults
- `read_settings` on corrupt JSON renames + re-seeds, returns defaults
- `write_settings` round-trips
- `detect_backends` with injected `PathLooker` finds 1-of-5 in fixture
- `detect_backends` times out gracefully on a fake hanging binary

### React component tests (`src/panels/firstrun/*.test.tsx`, `src/hooks/useFirstRun.test.ts`)

- MSW mocks for all 6 new Tauri commands
- Wizard mounts when `firstRun: true`, does not mount when `false`
- Each step's Skip advances without writing state
- Step 2 Allow → calls `request_notification_permission` → UI transitions `default` → `granted`
- Step 2 with `unavailable` auto-advances after 800ms (fake timers)
- Step 3 theme click → calls `bootstrap_update_settings` + `ThemeProvider.setTheme`
- Step 4 renders detected backends with version pills; radio selection persists
- "Get started" calls `bootstrap_complete` and unmounts wizard
- Settings → "Run setup wizard" → calls `reset_first_run` → re-mounts wizard

### Coverage

Same project thresholds: 100% lines/functions/statements, 95% branches (`CLAUDE.md` hard rule #7).

### Manual cross-platform smoke (PR checklist, not CI)

- macOS: notification permission dialog appears in System Settings → Notifications → Maverick
- Linux (Ubuntu + GNOME): notifications via D-Bus
- Windows: notifications via WinRT toast

---

## 9. Migration for Existing Users

Existing dev-build users (commits before this lands) should not see the wizard if they've already been using Maverick.

**Heuristic** — on first launch after upgrade, if `~/.maverick/settings.json` does not exist:

1. Bootstrap creates the tree.
2. Check `defaultDbPath()` (the SQLite location):
   - If the file exists AND is larger than 16 KiB (an empty DB with the schema applied is roughly that size; a never-used install would either lack the file or have a smaller stub): seed `settings.json` with `firstRunCompletedAt = Date.now()` (suppress wizard).
   - Else: seed with `firstRunCompletedAt = null` (show wizard).

We deliberately use file-existence-and-size rather than running SQL from Rust, to avoid adding `rusqlite` for a single check. False positives (someone has a stale DB file but no projects) result in the wizard not showing — minor downside, recoverable via `Settings → Run setup wizard`.

---

## 10. File Sizes & Layer Boundaries

Each new file stays focused under ~150 LOC. Layer boundaries from `CLAUDE.md`:

- Rust: pure pass-through + FS bootstrap. No business logic. ✓
- Sidecar: untouched by this spec. ✓
- React: wizard owns its UI state only; persistence via Tauri commands. ✓
- No new dependencies in the sidecar. ✓

---

## 11. Open Questions

None remaining as of brainstorming session 2026-05-26. All choices recorded in §4 and §5.

---

*This spec was produced via the `superpowers:brainstorming` skill. Next step: `superpowers:writing-plans` to produce an implementation plan.*
