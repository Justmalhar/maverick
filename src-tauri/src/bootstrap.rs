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
