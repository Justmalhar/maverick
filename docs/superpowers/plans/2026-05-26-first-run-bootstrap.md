# First-Run Bootstrap & Permission Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On first launch, Maverick creates `~/.maverick/` and the OS app data dir, then runs a skippable 4-step wizard (welcome → notification permission → theme → default backend) re-triggerable from Settings → General.

**Architecture:** Rust-owned filesystem bootstrap runs synchronously in `setup` before the sidecar spawns. `tauri-plugin-notification` adds the OS notification permission flow. React renders a full-screen wizard overlay driven by 6 typed Tauri commands. Bootstrap is idempotent; the sentinel lives in `~/.maverick/settings.json::firstRunCompletedAt`.

**Tech Stack:** Tauri v2, `tauri-plugin-notification`, `which` crate (PATH lookup), `tempfile` (Rust tests), React 19, Framer Motion, Vitest + MSW, shadcn primitives + Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-05-26-first-run-bootstrap-design.md`

---

## Pre-Flight

### Task 0: Create isolated worktree for this feature

**Files:**
- New branch: `cc-feature/first-run-bootstrap` (off `main`)

- [ ] **Step 1: Branch & switch**

```bash
git fetch origin
git checkout main
git pull
git checkout -b cc-feature/first-run-bootstrap
```

- [ ] **Step 2: Sanity check current state**

```bash
bun install
bun run test 2>&1 | tail -5
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -3
```

Expected: tests pass; `cargo check` exits 0.

---

## Zone 1 — Rust Bootstrap Foundation

### Task 1: Add Rust dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add `which`, `tauri-plugin-notification`, dev-dep `tempfile`**

Append/merge into `[dependencies]` and add `[dev-dependencies]` if missing:

```toml
[dependencies]
# ...existing...
tauri-plugin-notification = "2"
which = "6"

[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 2: Verify build**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

Expected: `Finished` with no errors. Warnings about unused deps are fine — they get consumed in later tasks.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(tauri): add tauri-plugin-notification, which, tempfile"
```

---

### Task 2: `bootstrap::MaverickPaths` + `ensure_dirs()` (TDD)

**Files:**
- Create: `src-tauri/src/bootstrap.rs`
- Modify: `src-tauri/src/lib.rs:1` (add `mod bootstrap;`)

- [ ] **Step 1: Write failing tests**

Create `src-tauri/src/bootstrap.rs`:

```rust
use std::fs;
use std::path::{Path, PathBuf};

/// Absolute paths Maverick reads/writes on startup. Computed once at boot.
#[derive(Debug, Clone)]
pub struct MaverickPaths {
    pub config_root: PathBuf, // ~/.maverick
    pub themes_dir: PathBuf,  // ~/.maverick/themes
    pub attachments_dir: PathBuf, // ~/.maverick/attachments
    pub settings_file: PathBuf, // ~/.maverick/settings.json
    pub global_md: PathBuf,   // ~/.maverick/GLOBAL.md
    pub app_data_dir: PathBuf, // OS app data dir (parent of db.sqlite)
    pub db_path: PathBuf,     // <app_data_dir>/db.sqlite
    pub logs_dir: PathBuf,    // <app_data_dir>/logs
}

impl MaverickPaths {
    /// Compute paths from a "home" root and the OS app-data root.
    /// Test-friendly: never reads env vars itself.
    pub fn from_roots(home: &Path, app_data: &Path) -> Self {
        let config_root = home.join(".maverick");
        let themes_dir = config_root.join("themes");
        let attachments_dir = config_root.join("attachments");
        let settings_file = config_root.join("settings.json");
        let global_md = config_root.join("GLOBAL.md");
        let app_data_dir = app_data.to_path_buf();
        let db_path = app_data_dir.join("db.sqlite");
        let logs_dir = app_data_dir.join("logs");
        Self {
            config_root,
            themes_dir,
            attachments_dir,
            settings_file,
            global_md,
            app_data_dir,
            db_path,
            logs_dir,
        }
    }
}

/// Create every directory the app expects to exist.
/// Idempotent. Returns the first error encountered; partial creation is OK
/// because subsequent runs will finish the job.
pub fn ensure_dirs(paths: &MaverickPaths) -> std::io::Result<()> {
    fs::create_dir_all(&paths.config_root)?;
    fs::create_dir_all(&paths.themes_dir)?;
    fs::create_dir_all(&paths.attachments_dir)?;
    fs::create_dir_all(&paths.app_data_dir)?;
    fs::create_dir_all(&paths.logs_dir)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn paths_in(tmp_home: &Path, tmp_data: &Path) -> MaverickPaths {
        MaverickPaths::from_roots(tmp_home, tmp_data)
    }

    #[test]
    fn ensure_dirs_creates_full_tree() {
        let home = tempdir().unwrap();
        let data = tempdir().unwrap();
        let paths = paths_in(home.path(), data.path());

        ensure_dirs(&paths).unwrap();

        assert!(paths.config_root.is_dir());
        assert!(paths.themes_dir.is_dir());
        assert!(paths.attachments_dir.is_dir());
        assert!(paths.app_data_dir.is_dir());
        assert!(paths.logs_dir.is_dir());
    }

    #[test]
    fn ensure_dirs_is_idempotent() {
        let home = tempdir().unwrap();
        let data = tempdir().unwrap();
        let paths = paths_in(home.path(), data.path());

        ensure_dirs(&paths).unwrap();
        ensure_dirs(&paths).unwrap(); // must not error on second call
    }

    #[test]
    fn from_roots_computes_expected_subpaths() {
        let p = MaverickPaths::from_roots(Path::new("/h"), Path::new("/d"));
        assert_eq!(p.config_root, PathBuf::from("/h/.maverick"));
        assert_eq!(p.themes_dir, PathBuf::from("/h/.maverick/themes"));
        assert_eq!(p.settings_file, PathBuf::from("/h/.maverick/settings.json"));
        assert_eq!(p.db_path, PathBuf::from("/d/db.sqlite"));
    }
}
```

Add the module to `src-tauri/src/lib.rs` at the top (after `mod commands;`):

```rust
mod bootstrap;
mod commands;
pub mod sidecar;
mod state;
```

- [ ] **Step 2: Run tests, verify they pass**

```bash
cargo test --manifest-path src-tauri/Cargo.toml bootstrap 2>&1 | tail -10
```

Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/bootstrap.rs src-tauri/src/lib.rs
git commit -m "feat(bootstrap): MaverickPaths + ensure_dirs (idempotent)"
```

---

### Task 3: `bootstrap::read_settings` + `write_settings` + `seed_global_md` (TDD)

**Files:**
- Modify: `src-tauri/src/bootstrap.rs`

- [ ] **Step 1: Add the settings types + tests at the bottom of `bootstrap.rs` (above the existing `#[cfg(test)]` block)**

Insert this code **before** the `#[cfg(test)] mod tests` block:

```rust
use serde::{Deserialize, Serialize};

pub const CURRENT_WIZARD_VERSION: u32 = 1;
const SCHEMA_VERSION: u32 = 1;
const DB_SUPPRESS_BYTES: u64 = 16 * 1024; // existing DB > this ⇒ treat as existing user

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MaverickSettings {
    pub schema_version: u32,
    pub wizard_version: u32,
    pub first_run_completed_at: Option<u64>,
    pub theme: String,
    pub default_backend: Option<String>,
    pub notifications_requested_at: Option<u64>,
}

impl MaverickSettings {
    pub fn defaults() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            wizard_version: CURRENT_WIZARD_VERSION,
            first_run_completed_at: None,
            theme: "maverick-dark".to_string(),
            default_backend: None,
            notifications_requested_at: None,
        }
    }

    /// Defaults for migration: pre-existing user, suppress wizard.
    pub fn defaults_completed(now_ms: u64) -> Self {
        Self {
            first_run_completed_at: Some(now_ms),
            ..Self::defaults()
        }
    }
}

/// Read settings.json. Missing → seed defaults (or completed-defaults for existing users).
/// Corrupt → rename + re-seed defaults.
pub fn read_settings(paths: &MaverickPaths, now_ms: u64) -> std::io::Result<MaverickSettings> {
    if !paths.settings_file.exists() {
        let seed = if existing_install(&paths.db_path) {
            MaverickSettings::defaults_completed(now_ms)
        } else {
            MaverickSettings::defaults()
        };
        write_settings(paths, &seed)?;
        return Ok(seed);
    }
    let raw = fs::read_to_string(&paths.settings_file)?;
    match serde_json::from_str::<MaverickSettings>(&raw) {
        Ok(s) => Ok(s),
        Err(_) => {
            // Corrupt: rename and re-seed defaults.
            let corrupt = paths
                .settings_file
                .with_extension(format!("json.corrupt-{now_ms}"));
            let _ = fs::rename(&paths.settings_file, &corrupt);
            let seed = MaverickSettings::defaults();
            write_settings(paths, &seed)?;
            Ok(seed)
        }
    }
}

/// Atomic-ish write: serialize → write tmp → rename.
pub fn write_settings(paths: &MaverickPaths, s: &MaverickSettings) -> std::io::Result<()> {
    let json = serde_json::to_string_pretty(s)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let tmp = paths.settings_file.with_extension("json.tmp");
    fs::write(&tmp, json)?;
    fs::rename(&tmp, &paths.settings_file)?;
    Ok(())
}

const GLOBAL_MD_SEED: &str = "<!-- Maverick global instructions.\n     This file is auto-prepended to every prompt sent to AI backends across ALL repos,\n     unless overridden by a project-local MAVERICK.md, CLAUDE.md, or AGENTS.md.\n     Edit freely; comments are stripped before injection. -->\n";

pub fn seed_global_md(paths: &MaverickPaths) -> std::io::Result<()> {
    if !paths.global_md.exists() {
        fs::write(&paths.global_md, GLOBAL_MD_SEED)?;
    }
    Ok(())
}

fn existing_install(db_path: &Path) -> bool {
    fs::metadata(db_path)
        .map(|m| m.len() > DB_SUPPRESS_BYTES)
        .unwrap_or(false)
}
```

Then add the matching tests to the existing `mod tests` block:

```rust
    #[test]
    fn read_settings_seeds_defaults_when_missing() {
        let home = tempdir().unwrap();
        let data = tempdir().unwrap();
        let paths = paths_in(home.path(), data.path());
        ensure_dirs(&paths).unwrap();

        let s = read_settings(&paths, 1_700_000_000_000).unwrap();
        assert_eq!(s.theme, "maverick-dark");
        assert_eq!(s.first_run_completed_at, None);
        assert!(paths.settings_file.exists());
    }

    #[test]
    fn read_settings_suppresses_wizard_for_existing_install() {
        let home = tempdir().unwrap();
        let data = tempdir().unwrap();
        let paths = paths_in(home.path(), data.path());
        ensure_dirs(&paths).unwrap();
        // simulate a real existing DB: 32 KiB of zeros
        fs::write(&paths.db_path, vec![0u8; 32 * 1024]).unwrap();

        let s = read_settings(&paths, 1_700_000_000_000).unwrap();
        assert_eq!(s.first_run_completed_at, Some(1_700_000_000_000));
    }

    #[test]
    fn read_settings_recovers_from_corrupt_json() {
        let home = tempdir().unwrap();
        let data = tempdir().unwrap();
        let paths = paths_in(home.path(), data.path());
        ensure_dirs(&paths).unwrap();
        fs::write(&paths.settings_file, "{not json").unwrap();

        let s = read_settings(&paths, 42).unwrap();
        assert_eq!(s, MaverickSettings::defaults());

        // corrupt file is renamed; new settings.json is valid JSON
        let renamed: Vec<_> = fs::read_dir(&paths.config_root)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("settings.json.corrupt-"))
            .collect();
        assert_eq!(renamed.len(), 1);
    }

    #[test]
    fn write_settings_round_trips() {
        let home = tempdir().unwrap();
        let data = tempdir().unwrap();
        let paths = paths_in(home.path(), data.path());
        ensure_dirs(&paths).unwrap();
        let mut s = MaverickSettings::defaults();
        s.theme = "dracula".to_string();
        s.default_backend = Some("codex".to_string());

        write_settings(&paths, &s).unwrap();
        let read_back = read_settings(&paths, 0).unwrap();
        assert_eq!(s, read_back);
    }

    #[test]
    fn seed_global_md_creates_when_missing_and_skips_when_present() {
        let home = tempdir().unwrap();
        let data = tempdir().unwrap();
        let paths = paths_in(home.path(), data.path());
        ensure_dirs(&paths).unwrap();

        seed_global_md(&paths).unwrap();
        assert!(paths.global_md.exists());

        // overwrite, call again, ensure we did NOT clobber
        fs::write(&paths.global_md, "user edits").unwrap();
        seed_global_md(&paths).unwrap();
        let kept = fs::read_to_string(&paths.global_md).unwrap();
        assert_eq!(kept, "user edits");
    }
```

- [ ] **Step 2: Run tests, verify pass**

```bash
cargo test --manifest-path src-tauri/Cargo.toml bootstrap 2>&1 | tail -15
```

Expected: 8 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/bootstrap.rs
git commit -m "feat(bootstrap): settings read/write + GLOBAL.md seed + migration heuristic"
```

---

### Task 4: `backend_detector` with injectable `PathLooker` (TDD)

**Files:**
- Create: `src-tauri/src/backend_detector.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod backend_detector;`)

- [ ] **Step 1: Write the module + tests**

Create `src-tauri/src/backend_detector.rs`:

```rust
use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetectedBackend {
    pub name: String,
    pub command: String,
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

/// Trait so tests can inject a fake PATH lookup + version probe.
pub trait BackendProbe: Send + Sync {
    fn locate(&self, command: &str) -> Option<PathBuf>;
    fn version(&self, command: &str, path: &PathBuf) -> Option<String>;
}

pub struct SystemProbe;

impl BackendProbe for SystemProbe {
    fn locate(&self, command: &str) -> Option<PathBuf> {
        which::which(command).ok()
    }

    fn version(&self, _command: &str, path: &PathBuf) -> Option<String> {
        // 2s timeout via std::process::Command + thread spawn.
        let path_clone = path.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let out = std::process::Command::new(&path_clone)
                .arg("--version")
                .output();
            let _ = tx.send(out);
        });
        match rx.recv_timeout(Duration::from_secs(2)) {
            Ok(Ok(out)) if out.status.success() => {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                Some(if s.is_empty() {
                    String::from_utf8_lossy(&out.stderr).trim().to_string()
                } else {
                    s
                })
            }
            _ => None,
        }
    }
}

const BACKENDS: &[(&str, &str)] = &[
    ("claude-code", "claude"),
    ("codex", "codex"),
    ("gemini", "gemini"),
    ("aider", "aider"),
    ("ollama", "ollama"),
];

pub fn detect_with(probe: &dyn BackendProbe) -> Vec<DetectedBackend> {
    BACKENDS
        .iter()
        .map(|(name, command)| match probe.locate(command) {
            Some(p) => {
                let version = probe.version(command, &p);
                DetectedBackend {
                    name: name.to_string(),
                    command: command.to_string(),
                    installed: true,
                    path: Some(p.to_string_lossy().into_owned()),
                    version,
                }
            }
            None => DetectedBackend {
                name: name.to_string(),
                command: command.to_string(),
                installed: false,
                path: None,
                version: None,
            },
        })
        .collect()
}

pub fn detect_all() -> Vec<DetectedBackend> {
    detect_with(&SystemProbe)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    struct FakeProbe {
        installed: HashMap<String, (PathBuf, Option<String>)>,
    }

    impl BackendProbe for FakeProbe {
        fn locate(&self, command: &str) -> Option<PathBuf> {
            self.installed.get(command).map(|(p, _)| p.clone())
        }
        fn version(&self, command: &str, _path: &PathBuf) -> Option<String> {
            self.installed.get(command).and_then(|(_, v)| v.clone())
        }
    }

    #[test]
    fn detect_with_returns_all_five_backends() {
        let probe = FakeProbe { installed: HashMap::new() };
        let detected = detect_with(&probe);
        assert_eq!(detected.len(), 5);
        assert!(detected.iter().all(|d| !d.installed));
    }

    #[test]
    fn detect_with_finds_one_when_present() {
        let mut installed = HashMap::new();
        installed.insert(
            "claude".to_string(),
            (PathBuf::from("/usr/local/bin/claude"), Some("claude 1.2.3".to_string())),
        );
        let probe = FakeProbe { installed };
        let detected = detect_with(&probe);
        let claude = detected.iter().find(|d| d.name == "claude-code").unwrap();
        assert!(claude.installed);
        assert_eq!(claude.path.as_deref(), Some("/usr/local/bin/claude"));
        assert_eq!(claude.version.as_deref(), Some("claude 1.2.3"));
        let codex = detected.iter().find(|d| d.name == "codex").unwrap();
        assert!(!codex.installed);
        assert!(codex.path.is_none());
    }

    #[test]
    fn detect_with_handles_version_unavailable() {
        let mut installed = HashMap::new();
        installed.insert(
            "ollama".to_string(),
            (PathBuf::from("/opt/ollama"), None),
        );
        let probe = FakeProbe { installed };
        let detected = detect_with(&probe);
        let ollama = detected.iter().find(|d| d.name == "ollama").unwrap();
        assert!(ollama.installed);
        assert!(ollama.version.is_none());
    }
}
```

Modify `src-tauri/src/lib.rs` (add to the module declarations near the top):

```rust
mod backend_detector;
mod bootstrap;
mod commands;
pub mod sidecar;
mod state;
```

- [ ] **Step 2: Run tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml backend_detector 2>&1 | tail -10
```

Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/backend_detector.rs src-tauri/src/lib.rs
git commit -m "feat(bootstrap): backend detector with injectable PATH probe"
```

---

### Task 5: Wire `MaverickPaths` into `AppState` + run bootstrap in `setup`

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Extend `AppState` to hold paths**

Replace the contents of `src-tauri/src/state.rs` with:

```rust
use std::sync::Arc;

use crate::bootstrap::MaverickPaths;
use crate::sidecar::Sidecar;

pub struct AppState {
    pub sidecar: Arc<Sidecar>,
    pub paths: MaverickPaths,
}

impl AppState {
    pub fn new(sidecar: Arc<Sidecar>, paths: MaverickPaths) -> Self {
        Self { sidecar, paths }
    }
}
```

- [ ] **Step 2: Wire ensure_dirs + seed_global_md into `lib.rs::setup`**

In `src-tauri/src/lib.rs`, locate the `.setup(|app| {` closure and modify the call to `AppState::new` plus add bootstrap calls at the top of the closure (before the sidecar spawn). The block should become:

```rust
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let handle = app.handle().clone();

            // Compute paths from OS-resolved roots (home + app-data dir).
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
            let app_data = handle
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("/tmp/maverick"));
            let paths = crate::bootstrap::MaverickPaths::from_roots(&home, &app_data);

            if let Err(e) = crate::bootstrap::ensure_dirs(&paths) {
                log::error!("ensure_dirs failed: {e}; running in degraded mode");
            }
            if let Err(e) = crate::bootstrap::seed_global_md(&paths) {
                log::warn!("seed_global_md failed: {e}");
            }

            let sink = Arc::new(TauriEventSink {
                handle: handle.clone(),
            });

            let (cmd, args, cwd) = if cfg!(debug_assertions) {
                dev_sidecar_command()
            } else {
                release_sidecar_command(&handle)
            };
            let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

            match tauri::async_runtime::block_on(async {
                Sidecar::spawn(&cmd, &arg_refs, cwd, sink).await
            }) {
                Ok(sidecar) => {
                    log::info!("sidecar spawned: {cmd}");
                    app.manage(AppState::new(sidecar, paths));
                }
                Err(e) => {
                    log::error!(
                        "sidecar failed to start (cmd='{cmd}'): {e:#}. UI in degraded mode."
                    );
                    app.manage(AppState::new(Sidecar::placeholder(), paths));
                }
            }
            Ok(())
        })
```

Also add `dirs = "5"` to `src-tauri/Cargo.toml` `[dependencies]` so `dirs::home_dir()` resolves:

```toml
dirs = "5"
```

- [ ] **Step 3: Verify**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

Expected: 11 tests pass (3 bootstrap dirs + 5 settings + 3 detector).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/state.rs src-tauri/src/lib.rs
git commit -m "feat(bootstrap): wire ensure_dirs + seed_global_md into Tauri setup"
```

---

### Task 6: Register `tauri-plugin-notification` + expand capability allowlist

**Files:**
- Modify: `src-tauri/src/lib.rs` (add plugin)
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Register the plugin**

In `src-tauri/src/lib.rs`, find the `tauri::Builder::default()` chain and add the notification plugin **before** `.setup(|app| {`:

```rust
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
```

- [ ] **Step 2: Add permissions**

Replace `src-tauri/capabilities/default.json` with:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "enables the default permissions",
  "windows": [
    "main"
  ],
  "permissions": [
    "core:default",
    "core:event:default",
    "core:webview:default",
    "core:window:default",
    "core:window:allow-start-dragging",
    "core:path:default",
    "shell:default",
    "shell:allow-spawn",
    "dialog:default",
    "dialog:allow-open",
    "dialog:allow-message",
    "notification:default",
    "notification:allow-request-permission",
    "notification:allow-is-permission-granted",
    "notification:allow-notify"
  ]
}
```

- [ ] **Step 3: Verify cargo build still passes**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat(bootstrap): register tauri-plugin-notification + capability allowlist"
```

---

## Zone 2 — Tauri Commands

### Task 7: `bootstrap_status` command

**Files:**
- Create: `src-tauri/src/commands/bootstrap.rs`
- Modify: `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Implement the command**

Create `src-tauri/src/commands/bootstrap.rs`:

```rust
use serde::Serialize;
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use tauri_plugin_notification::NotificationExt;

use crate::backend_detector::{detect_all, DetectedBackend};
use crate::bootstrap::{
    read_settings, seed_global_md, write_settings, MaverickSettings, CURRENT_WIZARD_VERSION,
};
use crate::state::AppState;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapPaths {
    pub config_root: String,
    pub db_path: String,
    pub logs_dir: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapStatusPayload {
    pub ok: bool,
    pub error: Option<String>,
    pub first_run: bool,
    pub wizard_version: u32,
    pub current_wizard_version: u32,
    pub paths: BootstrapPaths,
    pub settings: MaverickSettings,
    pub notification_permission: String,
}

#[tauri::command]
pub async fn bootstrap_status(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<BootstrapStatusPayload, String> {
    let paths = &state.paths;
    let (ok, error, settings) = match read_settings(paths, now_ms()) {
        Ok(s) => (true, None, s),
        Err(e) => (false, Some(e.to_string()), MaverickSettings::defaults()),
    };
    // Seed GLOBAL.md best-effort (don't fail status read on it).
    let _ = seed_global_md(paths);

    let notification_permission = match app.notification().permission_state() {
        Ok(tauri_plugin_notification::PermissionState::Granted) => "granted",
        Ok(tauri_plugin_notification::PermissionState::Denied) => "denied",
        Ok(tauri_plugin_notification::PermissionState::Unknown) => "default",
        Err(_) => "unavailable",
    }
    .to_string();

    Ok(BootstrapStatusPayload {
        ok,
        error,
        first_run: settings.first_run_completed_at.is_none(),
        wizard_version: settings.wizard_version,
        current_wizard_version: CURRENT_WIZARD_VERSION,
        paths: BootstrapPaths {
            config_root: paths.config_root.to_string_lossy().into_owned(),
            db_path: paths.db_path.to_string_lossy().into_owned(),
            logs_dir: paths.logs_dir.to_string_lossy().into_owned(),
        },
        settings,
        notification_permission,
    })
}
```

Modify `src-tauri/src/commands/mod.rs`:

```rust
pub mod attachment;
pub mod automation;
pub mod bootstrap;       // ← add
pub mod config;
// ...rest unchanged
```

Add at the bottom of the `pub use` section in `mod.rs`:

```rust
pub use bootstrap::bootstrap_status;
```

- [ ] **Step 2: Verify build**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

Expected: no errors. (Command isn't registered with `invoke_handler!` yet — that's Task 10.)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/bootstrap.rs src-tauri/src/commands/mod.rs
git commit -m "feat(commands): bootstrap_status reports first-run state + paths + permission"
```

---

### Task 8: `bootstrap_update_settings` + `bootstrap_complete` + `reset_first_run`

**Files:**
- Modify: `src-tauri/src/commands/bootstrap.rs`
- Modify: `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Add the three commands**

Append to `src-tauri/src/commands/bootstrap.rs`:

```rust
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub theme: Option<String>,
    pub default_backend: Option<String>,
    pub notifications_requested_at: Option<u64>,
}

#[tauri::command]
pub async fn bootstrap_update_settings(
    state: State<'_, AppState>,
    patch: SettingsPatch,
) -> Result<MaverickSettings, String> {
    let paths = &state.paths;
    let mut s = read_settings(paths, now_ms()).map_err(|e| e.to_string())?;
    // Wizard only ever ASSIGNS values; "missing in patch" === "don't change".
    // Explicit clearing isn't a user action in any current flow.
    if let Some(t) = patch.theme {
        s.theme = t;
    }
    if let Some(b) = patch.default_backend {
        s.default_backend = Some(b);
    }
    if let Some(n) = patch.notifications_requested_at {
        s.notifications_requested_at = Some(n);
    }
    write_settings(paths, &s).map_err(|e| e.to_string())?;
    Ok(s)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapCompletePayload {
    pub first_run_completed_at: u64,
}

#[tauri::command]
pub async fn bootstrap_complete(
    state: State<'_, AppState>,
) -> Result<BootstrapCompletePayload, String> {
    let paths = &state.paths;
    let mut s = read_settings(paths, now_ms()).map_err(|e| e.to_string())?;
    let t = now_ms();
    s.first_run_completed_at = Some(t);
    s.wizard_version = CURRENT_WIZARD_VERSION;
    write_settings(paths, &s).map_err(|e| e.to_string())?;
    Ok(BootstrapCompletePayload {
        first_run_completed_at: t,
    })
}

#[tauri::command]
pub async fn reset_first_run(state: State<'_, AppState>) -> Result<Value, String> {
    let paths = &state.paths;
    let mut s = read_settings(paths, now_ms()).map_err(|e| e.to_string())?;
    s.first_run_completed_at = None;
    write_settings(paths, &s).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}
```

Extend the `pub use bootstrap::` line in `mod.rs`:

```rust
pub use bootstrap::{
    bootstrap_complete, bootstrap_status, bootstrap_update_settings, reset_first_run,
};
```

- [ ] **Step 2: Verify build**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/bootstrap.rs src-tauri/src/commands/mod.rs
git commit -m "feat(commands): bootstrap_update_settings + bootstrap_complete + reset_first_run"
```

---

### Task 9: `detect_backends` + `request_notification_permission`

**Files:**
- Modify: `src-tauri/src/commands/bootstrap.rs`
- Modify: `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Add the two commands**

Append to `src-tauri/src/commands/bootstrap.rs`:

```rust
#[tauri::command]
pub async fn detect_backends() -> Result<Vec<DetectedBackend>, String> {
    // Spawn on a blocking thread so the 2s per-binary version probes
    // don't block the Tauri async runtime.
    tauri::async_runtime::spawn_blocking(detect_all)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn request_notification_permission(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Persist the request timestamp so we never auto-re-ask.
    let now = now_ms();
    let paths = &state.paths;
    if let Ok(mut s) = read_settings(paths, now) {
        s.notifications_requested_at = Some(now);
        let _ = write_settings(paths, &s);
    }

    match app.notification().request_permission() {
        Ok(tauri_plugin_notification::PermissionState::Granted) => Ok("granted".into()),
        Ok(tauri_plugin_notification::PermissionState::Denied) => Ok("denied".into()),
        Ok(tauri_plugin_notification::PermissionState::Unknown) => Ok("default".into()),
        Err(_) => Ok("unavailable".into()),
    }
}
```

Extend the `pub use` line in `mod.rs`:

```rust
pub use bootstrap::{
    bootstrap_complete, bootstrap_status, bootstrap_update_settings, detect_backends,
    request_notification_permission, reset_first_run,
};
```

- [ ] **Step 2: Verify build**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/bootstrap.rs src-tauri/src/commands/mod.rs
git commit -m "feat(commands): detect_backends + request_notification_permission"
```

---

### Task 10: Register all 6 new commands with Tauri `invoke_handler!`

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Register**

In `src-tauri/src/lib.rs`, locate the existing `.invoke_handler(tauri::generate_handler![...])` block and append the new commands to the list:

```rust
        .invoke_handler(tauri::generate_handler![
            project_add,
            project_list,
            // ...existing entries...
            notify_send,
            bootstrap_status,
            bootstrap_update_settings,
            bootstrap_complete,
            reset_first_run,
            detect_backends,
            request_notification_permission,
        ]);
```

- [ ] **Step 2: Verify**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(commands): register all bootstrap commands with invoke_handler"
```

---

## Zone 3 — TypeScript IPC Layer

### Task 11: Add TypeScript types to `src/lib/ipc.ts`

**Files:**
- Modify: `src/lib/ipc.ts`

- [ ] **Step 1: Append the new types**

Append to `src/lib/ipc.ts` (do not edit existing types):

```ts
export interface MaverickSettings {
  schemaVersion: number;
  wizardVersion: number;
  firstRunCompletedAt: number | null;
  theme: string;
  defaultBackend: string | null;
  notificationsRequestedAt: number | null;
}

export type NotificationPermission = "granted" | "denied" | "default" | "unavailable";

export interface BootstrapPaths {
  configRoot: string;
  dbPath: string;
  logsDir: string;
}

export interface BootstrapStatus {
  ok: boolean;
  error: string | null;
  firstRun: boolean;
  wizardVersion: number;
  currentWizardVersion: number;
  paths: BootstrapPaths;
  settings: MaverickSettings;
  notificationPermission: NotificationPermission;
}

export type KnownBackendName =
  | "claude-code"
  | "codex"
  | "gemini"
  | "aider"
  | "ollama";

export interface DetectedBackend {
  name: KnownBackendName;
  command: string;
  installed: boolean;
  path: string | null;
  version: string | null;
}

export interface SettingsPatch {
  theme?: string;
  defaultBackend?: string;
  notificationsRequestedAt?: number;
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ipc.ts
git commit -m "feat(ipc): types for bootstrap status, settings, detected backends"
```

---

### Task 12: Typed wrappers in `src/lib/tauri.ts`

**Files:**
- Modify: `src/lib/tauri.ts`

- [ ] **Step 1: Add wrappers**

Append to `src/lib/tauri.ts` (do not edit existing wrappers). At the top, add to the imports:

```ts
import type {
  // ...existing...
  BootstrapStatus,
  DetectedBackend,
  MaverickSettings,
  NotificationPermission,
  SettingsPatch,
} from "./ipc";
```

Then append at the bottom of the file:

```ts
export async function bootstrapStatus(): Promise<BootstrapStatus> {
  return invoke("bootstrap_status");
}

export async function bootstrapUpdateSettings(
  patch: SettingsPatch
): Promise<MaverickSettings> {
  return invoke("bootstrap_update_settings", { patch });
}

export async function bootstrapComplete(): Promise<{ firstRunCompletedAt: number }> {
  return invoke("bootstrap_complete");
}

export async function resetFirstRun(): Promise<void> {
  return invoke("reset_first_run");
}

export async function detectBackends(): Promise<DetectedBackend[]> {
  return invoke("detect_backends");
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  return invoke("request_notification_permission");
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/tauri.ts
git commit -m "feat(ipc): typed wrappers for the 6 bootstrap commands"
```

---

### Task 13: `useFirstRun` hook (TDD)

**Files:**
- Create: `src/hooks/useFirstRun.ts`
- Create: `src/hooks/useFirstRun.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/hooks/useFirstRun.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useFirstRun } from "./useFirstRun";
import type { BootstrapStatus } from "@/lib/ipc";

const baseStatus: BootstrapStatus = {
  ok: true,
  error: null,
  firstRun: true,
  wizardVersion: 0,
  currentWizardVersion: 1,
  paths: { configRoot: "/h/.maverick", dbPath: "/d/db.sqlite", logsDir: "/d/logs" },
  settings: {
    schemaVersion: 1,
    wizardVersion: 0,
    firstRunCompletedAt: null,
    theme: "maverick-dark",
    defaultBackend: null,
    notificationsRequestedAt: null,
  },
  notificationPermission: "default",
};

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useFirstRun", () => {
  it("opens when firstRun: true", async () => {
    mockInvoke.mockResolvedValueOnce(baseStatus);
    const { result } = renderHook(() => useFirstRun());
    await waitFor(() => expect(result.current.status).not.toBeNull());
    expect(result.current.open).toBe(true);
  });

  it("does not open when firstRun: false", async () => {
    mockInvoke.mockResolvedValueOnce({
      ...baseStatus,
      firstRun: false,
      settings: { ...baseStatus.settings, firstRunCompletedAt: 123 },
    });
    const { result } = renderHook(() => useFirstRun());
    await waitFor(() => expect(result.current.status).not.toBeNull());
    expect(result.current.open).toBe(false);
  });

  it("advance() increments step", async () => {
    mockInvoke.mockResolvedValueOnce(baseStatus);
    const { result } = renderHook(() => useFirstRun());
    await waitFor(() => expect(result.current.status).not.toBeNull());
    act(() => result.current.advance());
    expect(result.current.step).toBe(2);
  });

  it("complete() calls bootstrap_complete and closes the wizard", async () => {
    mockInvoke.mockResolvedValueOnce(baseStatus);
    const { result } = renderHook(() => useFirstRun());
    await waitFor(() => expect(result.current.status).not.toBeNull());
    mockInvoke.mockResolvedValueOnce({ firstRunCompletedAt: 999 });
    await act(async () => {
      await result.current.complete();
    });
    expect(mockInvoke).toHaveBeenCalledWith("bootstrap_complete");
    expect(result.current.open).toBe(false);
  });

  it("reset() calls reset_first_run and re-fetches status", async () => {
    mockInvoke.mockResolvedValueOnce({
      ...baseStatus,
      firstRun: false,
    });
    const { result } = renderHook(() => useFirstRun());
    await waitFor(() => expect(result.current.status).not.toBeNull());
    expect(result.current.open).toBe(false);

    mockInvoke.mockResolvedValueOnce(undefined); // reset_first_run
    mockInvoke.mockResolvedValueOnce(baseStatus); // re-fetched status

    await act(async () => {
      await result.current.reset();
    });
    expect(mockInvoke).toHaveBeenCalledWith("reset_first_run");
    expect(result.current.open).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
bun run test src/hooks/useFirstRun.test.ts 2>&1 | tail -15
```

Expected: import error / module not found for `useFirstRun`.

- [ ] **Step 3: Write the hook**

Create `src/hooks/useFirstRun.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import {
  bootstrapStatus,
  bootstrapComplete,
  resetFirstRun,
} from "@/lib/tauri";
import type { BootstrapStatus } from "@/lib/ipc";

export interface FirstRunController {
  open: boolean;
  step: 1 | 2 | 3 | 4;
  status: BootstrapStatus | null;
  advance: () => void;
  back: () => void;
  goTo: (step: 1 | 2 | 3 | 4) => void;
  refresh: () => Promise<void>;
  complete: () => Promise<void>;
  reset: () => Promise<void>;
}

export function useFirstRun(): FirstRunController {
  const [status, setStatus] = useState<BootstrapStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const refresh = useCallback(async () => {
    const s = await bootstrapStatus();
    setStatus(s);
    setOpen(s.firstRun);
    setStep(1);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const advance = useCallback(() => {
    setStep((s) => (s < 4 ? ((s + 1) as 1 | 2 | 3 | 4) : s));
  }, []);

  const back = useCallback(() => {
    setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : s));
  }, []);

  const goTo = useCallback((s: 1 | 2 | 3 | 4) => setStep(s), []);

  const complete = useCallback(async () => {
    await bootstrapComplete();
    setOpen(false);
    await refresh();
  }, [refresh]);

  const reset = useCallback(async () => {
    await resetFirstRun();
    await refresh();
  }, [refresh]);

  return { open, step, status, advance, back, goTo, refresh, complete, reset };
}
```

- [ ] **Step 4: Re-run tests and verify pass**

```bash
bun run test src/hooks/useFirstRun.test.ts 2>&1 | tail -10
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFirstRun.ts src/hooks/useFirstRun.test.ts
git commit -m "feat(hooks): useFirstRun controls wizard step + open state"
```

---

### Task 14: Add `@tauri-apps/plugin-notification` to package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the plugin**

```bash
bun add @tauri-apps/plugin-notification
```

- [ ] **Step 2: Verify**

```bash
bun run typecheck 2>&1 | tail -3
```

Expected: clean. (We don't import it in this plan — Rust handles the requests via Tauri commands — but adding it ensures the capability allowlist matches a known plugin and lets future Phase 15 work import the JS bindings.)

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore(deps): add @tauri-apps/plugin-notification"
```

---

## Zone 4 — Wizard UI

### Task 15: `FirstRunWizard` shell + step indicator (TDD)

**Files:**
- Create: `src/panels/firstrun/FirstRunWizard.tsx`
- Create: `src/panels/firstrun/FirstRunWizard.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/panels/firstrun/FirstRunWizard.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FirstRunWizard } from "./FirstRunWizard";
import * as hook from "@/hooks/useFirstRun";

function withController(overrides: Partial<ReturnType<typeof hook.useFirstRun>>) {
  vi.spyOn(hook, "useFirstRun").mockReturnValue({
    open: true,
    step: 1,
    status: {
      ok: true,
      error: null,
      firstRun: true,
      wizardVersion: 0,
      currentWizardVersion: 1,
      paths: { configRoot: "/h/.maverick", dbPath: "/d/db.sqlite", logsDir: "/d/logs" },
      settings: {
        schemaVersion: 1,
        wizardVersion: 0,
        firstRunCompletedAt: null,
        theme: "maverick-dark",
        defaultBackend: null,
        notificationsRequestedAt: null,
      },
      notificationPermission: "default",
    },
    advance: vi.fn(),
    back: vi.fn(),
    goTo: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
}

describe("FirstRunWizard", () => {
  it("renders nothing when open is false", () => {
    withController({ open: false });
    const { container } = render(<FirstRunWizard />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders step 1 by default with no Skip/Back buttons", () => {
    withController({});
    render(<FirstRunWizard />);
    expect(screen.getByTestId("firstrun-wizard")).toBeInTheDocument();
    expect(screen.getByTestId("firstrun-step-indicator")).toHaveTextContent("Step 1 / 4");
    expect(screen.queryByRole("button", { name: /skip/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /back/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeInTheDocument();
  });

  it("shows Skip + Back on step 2", () => {
    withController({ step: 2 });
    render(<FirstRunWizard />);
    expect(screen.getByRole("button", { name: /skip/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("step 4 primary button reads 'Get started' and calls complete()", async () => {
    const complete = vi.fn().mockResolvedValue(undefined);
    withController({ step: 4, complete });
    render(<FirstRunWizard />);
    const btn = screen.getByRole("button", { name: /get started/i });
    await userEvent.click(btn);
    expect(complete).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
bun run test src/panels/firstrun/FirstRunWizard.test.tsx 2>&1 | tail -10
```

Expected: import error.

- [ ] **Step 3: Implement the wizard shell**

Create `src/panels/firstrun/FirstRunWizard.tsx`:

```tsx
import { useFirstRun } from "@/hooks/useFirstRun";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { WelcomeStep } from "./steps/WelcomeStep";
import { PermissionsStep } from "./steps/PermissionsStep";
import { ThemeStep } from "./steps/ThemeStep";
import { BackendStep } from "./steps/BackendStep";

const LABELS = ["Welcome", "Permissions", "Theme", "Backend"] as const;

export function FirstRunWizard() {
  const ctrl = useFirstRun();
  if (!ctrl.open || !ctrl.status) return null;

  const StepBody = (() => {
    switch (ctrl.step) {
      case 1: return <WelcomeStep status={ctrl.status} />;
      case 2: return <PermissionsStep status={ctrl.status} onAdvance={ctrl.advance} />;
      case 3: return <ThemeStep />;
      case 4: return <BackendStep />;
    }
  })();

  const isFirst = ctrl.step === 1;
  const isLast = ctrl.step === 4;

  return (
    <motion.div
      data-testid="firstrun-wizard"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-overlay flex items-center justify-center bg-background/95 backdrop-blur"
    >
      <div className="flex w-full max-w-2xl flex-col gap-6 rounded-lg border border-border bg-card p-8 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {LABELS.map((label, i) => {
              const n = (i + 1) as 1 | 2 | 3 | 4;
              return (
                <div key={label} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "h-2 w-2 rounded-full",
                      n === ctrl.step ? "bg-primary" : n < ctrl.step ? "bg-primary/50" : "bg-muted"
                    )}
                  />
                  <span className={cn("text-[11px]", n === ctrl.step ? "text-foreground" : "text-muted-foreground")}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
          <span data-testid="firstrun-step-indicator" className="text-[11px] text-muted-foreground">
            Step {ctrl.step} / 4
          </span>
        </div>

        <div className="min-h-[280px]">{StepBody}</div>

        <div className="flex items-center justify-end gap-2">
          {!isFirst && (
            <Button variant="ghost" size="sm" onClick={ctrl.advance}>
              Skip
            </Button>
          )}
          {!isFirst && (
            <Button variant="ghost" size="sm" onClick={ctrl.back}>
              Back
            </Button>
          )}
          <Button
            variant="default"
            size="sm"
            onClick={isLast ? () => void ctrl.complete() : ctrl.advance}
          >
            {isLast ? "Get started" : "Continue"}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
```

This file imports four step components. Tasks 16–19 implement them — for now, create empty placeholder stubs so this file compiles. Create the four stub files now:

```bash
mkdir -p src/panels/firstrun/steps
```

Create `src/panels/firstrun/steps/WelcomeStep.tsx`:

```tsx
import type { BootstrapStatus } from "@/lib/ipc";
export function WelcomeStep({ status: _status }: { status: BootstrapStatus }) {
  return <div data-testid="firstrun-step-welcome" />;
}
```

Create `src/panels/firstrun/steps/PermissionsStep.tsx`:

```tsx
import type { BootstrapStatus } from "@/lib/ipc";
export function PermissionsStep({ status: _status, onAdvance: _onAdvance }: { status: BootstrapStatus; onAdvance: () => void }) {
  return <div data-testid="firstrun-step-permissions" />;
}
```

Create `src/panels/firstrun/steps/ThemeStep.tsx`:

```tsx
export function ThemeStep() {
  return <div data-testid="firstrun-step-theme" />;
}
```

Create `src/panels/firstrun/steps/BackendStep.tsx`:

```tsx
export function BackendStep() {
  return <div data-testid="firstrun-step-backend" />;
}
```

- [ ] **Step 4: Re-run the test, verify it passes**

```bash
bun run test src/panels/firstrun/FirstRunWizard.test.tsx 2>&1 | tail -10
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/panels/firstrun/
git commit -m "feat(firstrun): wizard shell + step indicator + footer rules"
```

---

### Task 16: Welcome step (TDD)

**Files:**
- Modify: `src/panels/firstrun/steps/WelcomeStep.tsx`
- Create: `src/panels/firstrun/steps/WelcomeStep.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/panels/firstrun/steps/WelcomeStep.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WelcomeStep } from "./WelcomeStep";
import type { BootstrapStatus } from "@/lib/ipc";

const status: BootstrapStatus = {
  ok: true,
  error: null,
  firstRun: true,
  wizardVersion: 0,
  currentWizardVersion: 1,
  paths: { configRoot: "/home/me/.maverick", dbPath: "/data/db.sqlite", logsDir: "/data/logs" },
  settings: {
    schemaVersion: 1, wizardVersion: 0, firstRunCompletedAt: null,
    theme: "maverick-dark", defaultBackend: null, notificationsRequestedAt: null,
  },
  notificationPermission: "default",
};

describe("WelcomeStep", () => {
  it("renders the three created paths", () => {
    render(<WelcomeStep status={status} />);
    expect(screen.getByText("/home/me/.maverick")).toBeInTheDocument();
    expect(screen.getByText("/data/db.sqlite")).toBeInTheDocument();
    expect(screen.getByText("/data/logs")).toBeInTheDocument();
  });

  it("clicking a path copies it to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<WelcomeStep status={status} />);
    await userEvent.click(screen.getByText("/home/me/.maverick"));
    expect(writeText).toHaveBeenCalledWith("/home/me/.maverick");
  });
});
```

- [ ] **Step 2: Run + verify fail**

```bash
bun run test src/panels/firstrun/steps/WelcomeStep.test.tsx 2>&1 | tail -8
```

Expected: assertion failures (placeholder renders empty div).

- [ ] **Step 3: Implement**

Replace `src/panels/firstrun/steps/WelcomeStep.tsx`:

```tsx
import { Folder, Database, FileText, ScrollText } from "lucide-react";
import type { BootstrapStatus } from "@/lib/ipc";

interface PathRowProps {
  icon: typeof Folder;
  label: string;
  path: string;
}

function PathRow({ icon: Icon, label, path }: PathRowProps) {
  function copy() {
    void navigator.clipboard.writeText(path);
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="flex w-full items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-left text-[12px] hover:bg-muted"
    >
      <span className="flex items-center gap-2 text-foreground">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        {label}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground">{path}</span>
    </button>
  );
}

export function WelcomeStep({ status }: { status: BootstrapStatus }) {
  const { paths } = status;
  return (
    <div data-testid="firstrun-step-welcome" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">Welcome to Maverick</h2>
        <p className="text-[12px] text-muted-foreground">
          Maverick has set up the following on this machine. You can edit files inside
          <span className="font-mono"> ~/.maverick </span> at any time.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <PathRow icon={Folder} label="Config root" path={paths.configRoot} />
        <PathRow icon={ScrollText} label="Themes & instructions" path={`${paths.configRoot}/themes`} />
        <PathRow icon={FileText} label="Global instructions" path={`${paths.configRoot}/GLOBAL.md`} />
        <PathRow icon={Database} label="Database" path={paths.dbPath} />
        <PathRow icon={Folder} label="Logs" path={paths.logsDir} />
      </div>
      <p className="text-[11px] text-muted-foreground">Click any row to copy its path.</p>
    </div>
  );
}
```

- [ ] **Step 4: Re-run + verify pass**

```bash
bun run test src/panels/firstrun/steps/WelcomeStep.test.tsx 2>&1 | tail -8
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/panels/firstrun/steps/WelcomeStep.tsx src/panels/firstrun/steps/WelcomeStep.test.tsx
git commit -m "feat(firstrun): welcome step shows created paths with copy-to-clipboard"
```

---

### Task 17: Permissions step (TDD, with auto-advance for `unavailable`)

**Files:**
- Modify: `src/panels/firstrun/steps/PermissionsStep.tsx`
- Create: `src/panels/firstrun/steps/PermissionsStep.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/panels/firstrun/steps/PermissionsStep.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { PermissionsStep } from "./PermissionsStep";
import type { BootstrapStatus } from "@/lib/ipc";

const baseStatus: BootstrapStatus = {
  ok: true,
  error: null,
  firstRun: true,
  wizardVersion: 0,
  currentWizardVersion: 1,
  paths: { configRoot: "/h/.maverick", dbPath: "/d/db.sqlite", logsDir: "/d/logs" },
  settings: {
    schemaVersion: 1, wizardVersion: 0, firstRunCompletedAt: null,
    theme: "maverick-dark", defaultBackend: null, notificationsRequestedAt: null,
  },
  notificationPermission: "default",
};

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("PermissionsStep", () => {
  it("renders Allow + Skip when permission is default", () => {
    render(<PermissionsStep status={baseStatus} onAdvance={vi.fn()} />);
    expect(screen.getByRole("button", { name: /allow notifications/i })).toBeInTheDocument();
    expect(screen.getByTestId("perm-state")).toHaveTextContent(/not yet asked/i);
  });

  it("shows 'granted' pill when already granted", () => {
    render(
      <PermissionsStep
        status={{ ...baseStatus, notificationPermission: "granted" }}
        onAdvance={vi.fn()}
      />
    );
    expect(screen.getByTestId("perm-state")).toHaveTextContent(/granted/i);
  });

  it("clicks Allow → invokes request_notification_permission → state pill updates", async () => {
    mockInvoke.mockResolvedValueOnce("granted");
    render(<PermissionsStep status={baseStatus} onAdvance={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /allow notifications/i }));
    expect(mockInvoke).toHaveBeenCalledWith("request_notification_permission");
    expect(await screen.findByText(/granted/i)).toBeInTheDocument();
  });

  it("when permission is unavailable, auto-advances after 800ms", async () => {
    vi.useFakeTimers();
    const onAdvance = vi.fn();
    render(
      <PermissionsStep
        status={{ ...baseStatus, notificationPermission: "unavailable" }}
        onAdvance={onAdvance}
      />
    );
    expect(onAdvance).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(onAdvance).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run + verify fail**

```bash
bun run test src/panels/firstrun/steps/PermissionsStep.test.tsx 2>&1 | tail -10
```

Expected: assertion failures.

- [ ] **Step 3: Implement**

Replace `src/panels/firstrun/steps/PermissionsStep.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Bell, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestNotificationPermission } from "@/lib/tauri";
import type { BootstrapStatus, NotificationPermission } from "@/lib/ipc";
import { cn } from "@/lib/utils";

interface Props {
  status: BootstrapStatus;
  onAdvance: () => void;
}

function StatePill({ state }: { state: NotificationPermission }) {
  const map = {
    default: { Icon: Bell, label: "Not yet asked", tone: "text-muted-foreground" },
    granted: { Icon: CheckCircle2, label: "Granted", tone: "text-success" },
    denied: { Icon: XCircle, label: "Denied", tone: "text-destructive" },
    unavailable: { Icon: AlertCircle, label: "Unavailable on this platform", tone: "text-muted-foreground" },
  } as const;
  const { Icon, label, tone } = map[state];
  return (
    <span data-testid="perm-state" className={cn("inline-flex items-center gap-1 text-[11px]", tone)}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

export function PermissionsStep({ status, onAdvance }: Props) {
  const [perm, setPerm] = useState<NotificationPermission>(status.notificationPermission);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (perm !== "unavailable") return;
    const t = setTimeout(onAdvance, 800);
    return () => clearTimeout(t);
  }, [perm, onAdvance]);

  async function onAllow() {
    setPending(true);
    try {
      const next = await requestNotificationPermission();
      setPerm(next);
    } finally {
      setPending(false);
    }
  }

  return (
    <div data-testid="firstrun-step-permissions" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">Notifications</h2>
        <p className="text-[12px] text-muted-foreground">
          Allow Maverick to notify you when agents finish, wait for input, or hit quota limits.
          You can change this later in System Settings.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-3">
        <div className="flex flex-col gap-1">
          <span className="text-[12px] text-foreground">OS notification permission</span>
          <StatePill state={perm} />
        </div>
        <Button
          variant="default"
          size="sm"
          disabled={pending || perm === "granted" || perm === "unavailable"}
          onClick={() => void onAllow()}
        >
          Allow notifications
        </Button>
      </div>

      {perm === "denied" && (
        <p className="text-[11px] text-muted-foreground">
          Notifications are denied. To enable, open System Settings → Notifications → Maverick.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Re-run + verify pass**

```bash
bun run test src/panels/firstrun/steps/PermissionsStep.test.tsx 2>&1 | tail -10
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/panels/firstrun/steps/PermissionsStep.tsx src/panels/firstrun/steps/PermissionsStep.test.tsx
git commit -m "feat(firstrun): permissions step with allow/deny + unavailable auto-advance"
```

---

### Task 18: Theme step (TDD)

**Files:**
- Modify: `src/panels/firstrun/steps/ThemeStep.tsx`
- Create: `src/panels/firstrun/steps/ThemeStep.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/panels/firstrun/steps/ThemeStep.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { ThemeStep } from "./ThemeStep";
import { ThemeProvider } from "@/themes/theme-provider";

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ThemeStep", () => {
  it("renders a card for every bundled theme", () => {
    render(
      <ThemeProvider>
        <ThemeStep />
      </ThemeProvider>
    );
    expect(screen.getAllByRole("button", { name: /apply theme/i }).length).toBeGreaterThanOrEqual(12);
  });

  it("clicking a theme card calls bootstrap_update_settings with that theme name", async () => {
    mockInvoke.mockResolvedValueOnce({ theme: "dracula" });
    render(
      <ThemeProvider>
        <ThemeStep />
      </ThemeProvider>
    );
    const dracula = screen.getByRole("button", { name: /apply theme dracula/i });
    await userEvent.click(dracula);
    expect(mockInvoke).toHaveBeenCalledWith(
      "bootstrap_update_settings",
      expect.objectContaining({ patch: expect.objectContaining({ theme: "dracula" }) })
    );
  });
});
```

- [ ] **Step 2: Run + verify fail**

```bash
bun run test src/panels/firstrun/steps/ThemeStep.test.tsx 2>&1 | tail -8
```

Expected: failure on assertion / button not found.

- [ ] **Step 3: Implement**

Replace `src/panels/firstrun/steps/ThemeStep.tsx`:

```tsx
import { useThemeContext } from "@/themes/theme-provider";
import { bootstrapUpdateSettings } from "@/lib/tauri";
import { cn } from "@/lib/utils";

function slugify(name: string) {
  return name.toLowerCase().replace(/\s+/g, "-");
}

export function ThemeStep() {
  const { theme, themes, setTheme } = useThemeContext();

  async function apply(t: typeof theme) {
    setTheme(t);
    await bootstrapUpdateSettings({ theme: slugify(t.name) });
  }

  return (
    <div data-testid="firstrun-step-theme" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">Pick a theme</h2>
        <p className="text-[12px] text-muted-foreground">
          Click any tile to apply. You can switch any time from Settings → Appearance.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {themes.map((t) => {
          const active = slugify(t.name) === slugify(theme.name);
          return (
            <button
              key={t.name}
              type="button"
              aria-label={`Apply theme ${slugify(t.name)}`}
              onClick={() => void apply(t)}
              className={cn(
                "flex flex-col items-start gap-1 rounded-md border px-3 py-2 text-left transition-colors",
                active ? "border-primary bg-primary/10" : "border-border bg-muted/30 hover:bg-muted"
              )}
            >
              <span className="text-[12px] text-foreground">{t.name}</span>
              <span className="text-[10px] text-muted-foreground">{t.type}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Re-run + verify pass**

```bash
bun run test src/panels/firstrun/steps/ThemeStep.test.tsx 2>&1 | tail -8
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/panels/firstrun/steps/ThemeStep.tsx src/panels/firstrun/steps/ThemeStep.test.tsx
git commit -m "feat(firstrun): theme step grid + apply via bootstrap_update_settings"
```

---

### Task 19: Backend step (TDD)

**Files:**
- Modify: `src/panels/firstrun/steps/BackendStep.tsx`
- Create: `src/panels/firstrun/steps/BackendStep.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/panels/firstrun/steps/BackendStep.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { BackendStep } from "./BackendStep";

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

const detected = [
  { name: "claude-code", command: "claude", installed: true, path: "/usr/local/bin/claude", version: "1.2.3" },
  { name: "codex", command: "codex", installed: false, path: null, version: null },
  { name: "gemini", command: "gemini", installed: true, path: "/opt/gemini", version: "0.5.0" },
  { name: "aider", command: "aider", installed: false, path: null, version: null },
  { name: "ollama", command: "ollama", installed: true, path: "/usr/bin/ollama", version: "0.4.1" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BackendStep", () => {
  it("calls detect_backends on mount and renders one row per backend", async () => {
    mockInvoke.mockResolvedValueOnce(detected);
    render(<BackendStep />);
    expect(await screen.findByText("claude-code")).toBeInTheDocument();
    expect(screen.getByText("codex")).toBeInTheDocument();
    expect(screen.getByText("gemini")).toBeInTheDocument();
    expect(screen.getByText("aider")).toBeInTheDocument();
    expect(screen.getByText("ollama")).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith("detect_backends");
  });

  it("installed backends show version pill; missing show 'not found'", async () => {
    mockInvoke.mockResolvedValueOnce(detected);
    render(<BackendStep />);
    expect(await screen.findByText("1.2.3")).toBeInTheDocument();
    expect(screen.getAllByText(/not found/i).length).toBe(2);
  });

  it("selecting a backend writes via bootstrap_update_settings", async () => {
    mockInvoke.mockResolvedValueOnce(detected); // detect_backends
    render(<BackendStep />);
    await screen.findByText("claude-code");

    mockInvoke.mockResolvedValueOnce({}); // update_settings
    await userEvent.click(screen.getByRole("radio", { name: /claude-code/i }));
    expect(mockInvoke).toHaveBeenCalledWith(
      "bootstrap_update_settings",
      expect.objectContaining({ patch: { defaultBackend: "claude-code" } })
    );
  });
});
```

- [ ] **Step 2: Run + verify fail**

```bash
bun run test src/panels/firstrun/steps/BackendStep.test.tsx 2>&1 | tail -10
```

Expected: failures (placeholder).

- [ ] **Step 3: Implement**

Replace `src/panels/firstrun/steps/BackendStep.tsx`:

```tsx
import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { bootstrapUpdateSettings, detectBackends } from "@/lib/tauri";
import type { DetectedBackend } from "@/lib/ipc";
import { cn } from "@/lib/utils";

export function BackendStep() {
  const [rows, setRows] = useState<DetectedBackend[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    detectBackends().then((r) => {
      if (!cancelled) setRows(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function pick(name: string) {
    setPicked(name);
    await bootstrapUpdateSettings({ defaultBackend: name });
  }

  return (
    <div data-testid="firstrun-step-backend" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">Default backend</h2>
        <p className="text-[12px] text-muted-foreground">
          We scanned <span className="font-mono">$PATH</span> for known AI CLIs. Pick a default
          for new workspaces, or skip to choose each time.
        </p>
      </div>

      {rows === null ? (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Scanning your PATH…
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <li key={row.name}>
              <label
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between rounded-md border px-3 py-2",
                  picked === row.name ? "border-primary bg-primary/10" : "border-border bg-muted/30 hover:bg-muted",
                  !row.installed && "opacity-60"
                )}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="default-backend"
                    aria-label={row.name}
                    disabled={!row.installed}
                    checked={picked === row.name}
                    onChange={() => void pick(row.name)}
                    className="accent-primary"
                  />
                  {row.installed ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <span className="text-[12px] text-foreground">{row.name}</span>
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {row.installed ? (row.version ?? "installed") : "not found"}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Re-run + verify pass**

```bash
bun run test src/panels/firstrun/steps/BackendStep.test.tsx 2>&1 | tail -10
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/panels/firstrun/steps/BackendStep.tsx src/panels/firstrun/steps/BackendStep.test.tsx
git commit -m "feat(firstrun): backend detection step with PATH probe + radio picker"
```

---

### Task 20: Mount `FirstRunWizard` from `Workbench`

**Files:**
- Modify: `src/components/workbench/Workbench.tsx`

- [ ] **Step 1: Add lazy import + render**

In `src/components/workbench/Workbench.tsx`, find the lazy imports near the top:

```tsx
const PresetPicker = lazy(() => import("@/panels/presets/PresetPicker"));
const SettingsPanel = lazy(() => import("@/panels/settings/SettingsPanel"));
const ProjectSettingsPanel = lazy(() => import("@/panels/project-settings/ProjectSettingsPanel"));
```

Add a fourth lazy import line:

```tsx
const FirstRunWizard = lazy(() =>
  import("@/panels/firstrun/FirstRunWizard").then((m) => ({ default: m.FirstRunWizard }))
);
```

Then in the JSX, just before the closing `</div>` of the workbench container (after the existing `<ProjectSettingsPanel>` block), add:

```tsx
      <Suspense fallback={<OverlayFallback />}>
        <FirstRunWizard />
      </Suspense>
```

- [ ] **Step 2: Verify typecheck + test still pass**

```bash
bun run typecheck 2>&1 | tail -5
bun run test src/components/workbench 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/workbench/Workbench.tsx
git commit -m "feat(firstrun): mount FirstRunWizard inside Workbench"
```

---

## Zone 5 — Settings Integration

### Task 21: "Run setup wizard" entry in General settings

**Files:**
- Modify: `src/panels/settings/sections/GeneralSettings.tsx`
- Modify: `src/panels/settings/sections/GeneralSettings.test.tsx`

- [ ] **Step 1: Write failing test**

Append to `src/panels/settings/sections/GeneralSettings.test.tsx` (inside the existing `describe` block):

```tsx
  it("Run setup wizard button calls reset_first_run", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const { invoke } = await import("@tauri-apps/api/core");
    const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
    mockInvoke.mockResolvedValueOnce(undefined);
    const { render, screen } = await import("@testing-library/react");
    const GeneralSettings = (await import("./GeneralSettings")).default;
    render(<GeneralSettings />);
    await userEvent.click(screen.getByRole("button", { name: /run setup wizard/i }));
    expect(mockInvoke).toHaveBeenCalledWith("reset_first_run");
  });
```

- [ ] **Step 2: Add the button**

Modify `src/panels/settings/sections/GeneralSettings.tsx` — append a new `<SettingsGroup>` at the bottom of the component (before the closing `</div>`):

```tsx
      <SettingsGroup title="First-run" description="Re-trigger the welcome wizard.">
        <SettingsRow
          title="Run setup wizard"
          description="Walks you through directory creation, permissions, theme, and default backend."
          control={
            <Button
              variant="outline"
              size="sm"
              data-testid="general-run-setup-wizard"
              onClick={async () => {
                const { resetFirstRun } = await import("@/lib/tauri");
                await resetFirstRun();
              }}
            >
              Run setup wizard
            </Button>
          }
        />
      </SettingsGroup>
```

Add the import at the top:

```tsx
import { Button } from "@/components/ui/button";
```

- [ ] **Step 3: Run tests**

```bash
bun run test src/panels/settings/sections/GeneralSettings.test.tsx 2>&1 | tail -8
```

Expected: existing tests still pass + new test passes.

- [ ] **Step 4: Commit**

```bash
git add src/panels/settings/sections/GeneralSettings.tsx src/panels/settings/sections/GeneralSettings.test.tsx
git commit -m "feat(settings): General → 'Run setup wizard' re-triggers first-run flow"
```

---

### Task 22: "Request notification permission" entry in Notifications settings

**Files:**
- Modify: `src/panels/settings/sections/NotificationsSettings.tsx`
- Modify: `src/panels/settings/sections/NotificationsSettings.test.tsx`

- [ ] **Step 1: Write failing test**

Append to `NotificationsSettings.test.tsx`:

```tsx
  it("Request notification permission button calls the Tauri command", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const { invoke } = await import("@tauri-apps/api/core");
    const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
    mockInvoke.mockResolvedValueOnce("granted");
    const { render, screen } = await import("@testing-library/react");
    const NotificationsSettings = (await import("./NotificationsSettings")).default;
    render(<NotificationsSettings />);
    await userEvent.click(screen.getByRole("button", { name: /request notification permission/i }));
    expect(mockInvoke).toHaveBeenCalledWith("request_notification_permission");
  });
```

- [ ] **Step 2: Implement**

In `src/panels/settings/sections/NotificationsSettings.tsx`, add a new `<SettingsGroup>` at the bottom:

```tsx
      <SettingsGroup title="System permission" description="Maverick uses your OS to deliver notifications.">
        <SettingsRow
          title="OS notification permission"
          description="Re-request permission. If you previously denied it, change it in System Settings."
          control={
            <Button
              variant="outline"
              size="sm"
              data-testid="notifications-request-permission"
              onClick={async () => {
                const { requestNotificationPermission } = await import("@/lib/tauri");
                await requestNotificationPermission();
              }}
            >
              Request notification permission
            </Button>
          }
        />
      </SettingsGroup>
```

Add the import:

```tsx
import { Button } from "@/components/ui/button";
```

- [ ] **Step 3: Run tests**

```bash
bun run test src/panels/settings/sections/NotificationsSettings.test.tsx 2>&1 | tail -8
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/panels/settings/sections/NotificationsSettings.tsx src/panels/settings/sections/NotificationsSettings.test.tsx
git commit -m "feat(settings): Notifications → 'Request notification permission' button"
```

---

## Zone 6 — End-to-End Verification

### Task 23: Full coverage + lint + typecheck

**Files:** none

- [ ] **Step 1: Full vitest run with coverage**

```bash
bun run test:coverage 2>&1 | tail -25
```

Expected: all tests pass; coverage thresholds met (lines 100, functions 100, statements 100, branches 95). If branches drop below 95, add the missing test cases — do NOT lower the threshold.

- [ ] **Step 2: Sidecar tests still pass**

```bash
bun run test:sidecar 2>&1 | tail -8
```

Expected: clean.

- [ ] **Step 3: Rust tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10
```

Expected: 11+ tests pass (bootstrap, backend_detector).

- [ ] **Step 4: Typecheck + build**

```bash
bun run typecheck 2>&1 | tail -3
bun run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 5: Commit any fixups**

If you added tests in Step 1 to recover branches, commit them:

```bash
git add -A
git commit -m "test(firstrun): cover remaining branches"
```

If nothing changed, skip the commit.

---

### Task 24: Manual smoke test (cross-platform checklist)

**Files:** none — manual verification only.

- [ ] **Step 1: macOS smoke**

```bash
rm -rf ~/.maverick                                # simulate fresh install
rm -f "$HOME/Library/Application Support/maverick/db.sqlite"
bun run tauri dev
```

Verify:
1. `~/.maverick/` is created with `themes/`, `attachments/`, `GLOBAL.md`, `settings.json`.
2. `~/Library/Application Support/maverick/` exists.
3. Wizard step 1 lists those paths; clicking a row copies it.
4. Wizard step 2 "Allow notifications" opens the macOS permission dialog. Granting it updates the pill to "Granted".
5. Wizard step 3 theme grid shows 14 themes; clicking applies live.
6. Wizard step 4 lists 5 backends, with version pills for installed ones.
7. "Get started" closes the wizard. Quit + relaunch → wizard does NOT re-appear.
8. Settings → General → Run setup wizard → wizard re-opens.

- [ ] **Step 2: Migration smoke**

```bash
rm -f ~/.maverick/settings.json
dd if=/dev/zero of="$HOME/Library/Application Support/maverick/db.sqlite" bs=1024 count=64
bun run tauri dev
```

Verify the wizard does NOT show (the heuristic suppresses it because the DB is >16 KiB). `~/.maverick/settings.json` should now exist with `firstRunCompletedAt: <number>`.

- [ ] **Step 3: Note any cross-platform gaps**

If you only have macOS, leave a note in the PR description: "Linux + Windows tested in CI only; manual smoke pending for those platforms."

---

### Task 25: Open PR

**Files:** none.

- [ ] **Step 1: Push branch**

```bash
git push -u origin cc-feature/first-run-bootstrap
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat: first-run bootstrap + permission wizard" --body "$(cat <<'EOF'
## Summary
- Creates ~/.maverick/ + OS app data dir on first launch (idempotent, Rust-owned).
- 4-step wizard: Welcome → Permissions → Theme → Default backend.
- Adds tauri-plugin-notification with capability allowlist entries.
- Re-runnable from Settings → General → "Run setup wizard"; Notifications section has a separate "Request notification permission" button.
- Migration heuristic: existing dev users (DB > 16 KiB) auto-suppress the wizard.

## Test plan
- [x] `cargo test --manifest-path src-tauri/Cargo.toml` — 11+ tests pass
- [x] `bun run test:coverage` — thresholds met (100/100/100/95)
- [x] `bun run test:sidecar`
- [x] macOS manual smoke (fresh + migration scenarios)
- [ ] Linux manual smoke (deferred)
- [ ] Windows manual smoke (deferred)

## Spec / Plan
- Spec: `docs/superpowers/specs/2026-05-26-first-run-bootstrap-design.md`
- Plan: `docs/superpowers/plans/2026-05-26-first-run-bootstrap.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Paste into the loop output for review.

---

## Reference: File inventory

**New (Rust):**
- `src-tauri/src/bootstrap.rs`
- `src-tauri/src/backend_detector.rs`
- `src-tauri/src/commands/bootstrap.rs`

**Modified (Rust):**
- `src-tauri/Cargo.toml` — add `tauri-plugin-notification`, `which`, `dirs`, dev-dep `tempfile`
- `src-tauri/src/lib.rs` — register plugin, bootstrap call in setup, invoke_handler entries
- `src-tauri/src/state.rs` — `paths: MaverickPaths` field
- `src-tauri/src/commands/mod.rs` — module + re-exports
- `src-tauri/capabilities/default.json` — notification permissions

**New (React):**
- `src/hooks/useFirstRun.ts` + `.test.ts`
- `src/panels/firstrun/FirstRunWizard.tsx` + `.test.tsx`
- `src/panels/firstrun/steps/WelcomeStep.tsx` + `.test.tsx`
- `src/panels/firstrun/steps/PermissionsStep.tsx` + `.test.tsx`
- `src/panels/firstrun/steps/ThemeStep.tsx` + `.test.tsx`
- `src/panels/firstrun/steps/BackendStep.tsx` + `.test.tsx`

**Modified (React):**
- `src/lib/ipc.ts` — `MaverickSettings`, `DetectedBackend`, `BootstrapStatus`, etc.
- `src/lib/tauri.ts` — 6 typed wrappers
- `src/components/workbench/Workbench.tsx` — lazy-mount wizard
- `src/panels/settings/sections/GeneralSettings.tsx` + `.test.tsx` — "Run setup wizard"
- `src/panels/settings/sections/NotificationsSettings.tsx` + `.test.tsx` — "Request notification permission"
- `package.json` + `bun.lock` — `@tauri-apps/plugin-notification`

---

*Total tasks: 25 (1 preflight + 22 implementation + 2 verification). Estimated ~1–2 days for one engineer working linearly. Subagent-driven execution can parallelise Zone 4 step components (Tasks 16–19) after Task 15 lands.*
