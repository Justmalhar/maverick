use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

/// Absolute paths Maverick reads/writes on startup. Computed once at boot.
#[derive(Debug, Clone)]
pub struct MaverickPaths {
    pub config_root: PathBuf, // ~/.maverick
    pub themes_dir: PathBuf,  // ~/.maverick/themes
    pub attachments_dir: PathBuf, // ~/.maverick/attachments
    pub settings_file: PathBuf, // ~/.maverick/settings.json
    pub maverick_md: PathBuf, // ~/.maverick/MAVERICK.md (auto-prepended to every agent prompt)
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
        let maverick_md = config_root.join("MAVERICK.md");
        let app_data_dir = app_data.to_path_buf();
        let db_path = app_data_dir.join("db.sqlite");
        let logs_dir = app_data_dir.join("logs");
        Self {
            config_root,
            themes_dir,
            attachments_dir,
            settings_file,
            maverick_md,
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

const MAVERICK_MD_SEED: &str = "<!-- Your global Maverick instructions.\n     This file is auto-prepended to every conversation with every AI agent.\n     Drop a MAVERICK.md inside any repository to override these notes for that project.\n     Edit freely; HTML comments like this one are stripped before injection. -->\n";

pub fn seed_maverick_md(paths: &MaverickPaths) -> std::io::Result<()> {
    if !paths.maverick_md.exists() {
        fs::write(&paths.maverick_md, MAVERICK_MD_SEED)?;
    }
    Ok(())
}

fn existing_install(db_path: &Path) -> bool {
    fs::metadata(db_path)
        .map(|m| m.len() > DB_SUPPRESS_BYTES)
        .unwrap_or(false)
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
    fn seed_maverick_md_creates_when_missing_and_skips_when_present() {
        let home = tempdir().unwrap();
        let data = tempdir().unwrap();
        let paths = paths_in(home.path(), data.path());
        ensure_dirs(&paths).unwrap();

        seed_maverick_md(&paths).unwrap();
        assert!(paths.maverick_md.exists());

        // overwrite, call again, ensure we did NOT clobber
        fs::write(&paths.maverick_md, "user edits").unwrap();
        seed_maverick_md(&paths).unwrap();
        let kept = fs::read_to_string(&paths.maverick_md).unwrap();
        assert_eq!(kept, "user edits");
    }
}
