//! Rust-owned persistence for the companion security layer:
//!
//! - The desktop's **static identity** (X25519 private key) at
//!   `~/.maverick/companion/identity.key` (0600). Generated once, reused.
//! - The **paired-device store** at `~/.maverick/companion/devices.json`: each
//!   row is a TOFU-pinned client static key + its device id + metadata. Listed
//!   by `remote_devices`, removed by `remote_revoke`.
//!
//! Per ADR-1 the Rust core owns this — NOT the Bun sidecar. None of this is a
//! provider credential; backends still read their own CLI config. We never read
//! `~/.claude.json`, `~/.config/codex`, etc.
//!
//! TOFU semantics (mirrors the client's `TofuPinner`): first pairing for a given
//! device id pins the key; a subsequent pairing presenting a *different* key for
//! the same id is a MITM signal and is rejected. Revoking a device deletes its
//! row (and the caller tears down its live sessions).

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::remote::pairing::{b64url, b64url_decode, short_fingerprint, KEY_LEN};

/// A persisted paired device: its stable id (base64url SHA-256 of the static
/// key), the pinned client static public key (base64url), a human label, and the
/// pairing token that authorized it (for audit / display only — never a bearer).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PairedDevice {
    /// Stable device id = base64url(SHA-256(static_key)).
    pub device_id: String,
    /// Pinned client static X25519 public key, base64url (TOFU anchor).
    pub static_key: String,
    /// Human-readable name (from the pairing session, falls back to a fingerprint).
    pub name: String,
    /// Short fingerprint of the static key for the device-list badge.
    pub fingerprint: String,
    /// Unix-ms timestamp the device was first paired.
    pub paired_at: i64,
}

/// On-disk shape of the device store (versioned for forward-compat).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct DeviceFile {
    version: u32,
    devices: Vec<PairedDevice>,
}

impl Default for DeviceFile {
    fn default() -> Self {
        Self { version: 1, devices: Vec::new() }
    }
}

/// Outcome of pinning a device's static key on pairing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PinOutcome {
    /// First time this device id is seen — newly pinned.
    FirstUse,
    /// Already pinned to this exact key — a known device re-pairing.
    AlreadyPinned,
}

/// Errors from the device store.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeviceStoreError {
    /// The presented static key differs from the pinned one for this device id.
    TofuMismatch,
    /// An I/O / serialization failure touching the store file.
    Io(String),
}

impl std::fmt::Display for DeviceStoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DeviceStoreError::TofuMismatch => {
                write!(f, "device static key changed since first pairing (TOFU mismatch)")
            }
            DeviceStoreError::Io(e) => write!(f, "device store io: {e}"),
        }
    }
}

impl std::error::Error for DeviceStoreError {}

/// Persistent, process-wide paired-device store + static identity loader, rooted
/// at a companion directory (`~/.maverick/companion`). The in-memory `Mutex`
/// snapshot is the source of truth; every mutation re-serializes the whole file
/// atomically (write-temp-then-rename) so a crash never leaves a torn store.
pub struct DeviceStore {
    dir: PathBuf,
    devices: Mutex<Vec<PairedDevice>>,
}

impl DeviceStore {
    /// Path to the static identity key file under `dir`.
    fn identity_path(dir: &Path) -> PathBuf {
        dir.join("identity.key")
    }

    /// Path to the devices JSON under `dir`.
    fn devices_path(dir: &Path) -> PathBuf {
        dir.join("devices.json")
    }

    /// Open (or initialize) a store rooted at `dir`, creating the directory if
    /// needed and loading any existing devices. A malformed devices file is
    /// treated as empty (logged) rather than fatal — pairing still works, and the
    /// next write heals the file.
    pub fn open(dir: PathBuf) -> Result<Self, DeviceStoreError> {
        fs::create_dir_all(&dir).map_err(|e| DeviceStoreError::Io(e.to_string()))?;
        let path = Self::devices_path(&dir);
        let devices = match fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str::<DeviceFile>(&text)
                .map(|f| f.devices)
                .unwrap_or_else(|e| {
                    log::warn!("device store: malformed {path:?}, starting empty: {e}");
                    Vec::new()
                }),
            Err(_) => Vec::new(),
        };
        Ok(Self { dir, devices: Mutex::new(devices) })
    }

    /// Load the persisted static identity private key, or `None` if absent /
    /// wrong-length. The caller generates + saves one when this returns `None`.
    pub fn load_identity_private(&self) -> Option<[u8; KEY_LEN]> {
        let path = Self::identity_path(&self.dir);
        let bytes = fs::read(&path).ok()?;
        if bytes.len() != KEY_LEN {
            log::warn!("device store: identity.key wrong length ({}); regenerating", bytes.len());
            return None;
        }
        let mut out = [0u8; KEY_LEN];
        out.copy_from_slice(&bytes);
        Some(out)
    }

    /// Persist the static identity private key with 0600 permissions (owner-only).
    pub fn save_identity_private(&self, private: &[u8; KEY_LEN]) -> Result<(), DeviceStoreError> {
        let path = Self::identity_path(&self.dir);
        write_private_file(&path, private).map_err(|e| DeviceStoreError::Io(e.to_string()))
    }

    /// TOFU-pin a client static key against its device id. First sight pins +
    /// persists; a re-pair with the same key is a no-op match; a different key
    /// for the same id is a mismatch (rejected). `name` labels the device.
    pub fn pin(
        &self,
        device_id: &str,
        static_key: &[u8],
        name: &str,
    ) -> Result<PinOutcome, DeviceStoreError> {
        let key_b64 = b64url(static_key);
        let mut guard = self.devices.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(existing) = guard.iter().find(|d| d.device_id == device_id) {
            // Constant-time-ish exact-string compare of the pinned key.
            if existing.static_key != key_b64 {
                return Err(DeviceStoreError::TofuMismatch);
            }
            return Ok(PinOutcome::AlreadyPinned);
        }
        let label = if name.trim().is_empty() {
            format!("device {}", short_fingerprint(static_key))
        } else {
            name.to_string()
        };
        guard.push(PairedDevice {
            device_id: device_id.to_string(),
            static_key: key_b64,
            name: label,
            fingerprint: short_fingerprint(static_key),
            paired_at: now_ms(),
        });
        self.persist(&guard)?;
        Ok(PinOutcome::FirstUse)
    }

    /// Whether a device id is currently paired (used by the auth gate to admit a
    /// reconnect, and by tests).
    pub fn is_paired(&self, device_id: &str) -> bool {
        self.devices
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .any(|d| d.device_id == device_id)
    }

    /// The pinned static key bytes for a device id, if paired.
    pub fn pinned_key(&self, device_id: &str) -> Option<Vec<u8>> {
        self.devices
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .find(|d| d.device_id == device_id)
            .and_then(|d| b64url_decode(&d.static_key).ok())
    }

    /// Snapshot of all paired devices for `remote_devices`.
    pub fn list(&self) -> Vec<PairedDevice> {
        self.devices.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Revoke (delete) a device by id. Returns whether a row was removed. The
    /// caller is responsible for tearing down that device's live sessions.
    pub fn revoke(&self, device_id: &str) -> Result<bool, DeviceStoreError> {
        let mut guard = self.devices.lock().unwrap_or_else(|e| e.into_inner());
        let before = guard.len();
        guard.retain(|d| d.device_id != device_id);
        let removed = guard.len() != before;
        if removed {
            self.persist(&guard)?;
        }
        Ok(removed)
    }

    fn persist(&self, devices: &[PairedDevice]) -> Result<(), DeviceStoreError> {
        let file = DeviceFile { version: 1, devices: devices.to_vec() };
        let json = serde_json::to_string_pretty(&file)
            .map_err(|e| DeviceStoreError::Io(e.to_string()))?;
        atomic_write(&Self::devices_path(&self.dir), json.as_bytes())
            .map_err(|e| DeviceStoreError::Io(e.to_string()))
    }
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Atomically write `bytes` to `path` via a sibling temp file + rename so a
/// concurrent reader never sees a half-written store.
fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)
}

/// Write a secret file with owner-only (0600) permissions on Unix. On non-Unix
/// the mode bits are a no-op; the file still lands in the user's private app dir.
fn write_private_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    atomic_write(path, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn store() -> (TempDir, DeviceStore) {
        let tmp = TempDir::new().unwrap();
        let store = DeviceStore::open(tmp.path().join("companion")).unwrap();
        (tmp, store)
    }

    #[test]
    fn identity_persists_and_reloads_with_0600() {
        let (tmp, store) = store();
        assert!(store.load_identity_private().is_none(), "empty before save");
        let key = [42u8; KEY_LEN];
        store.save_identity_private(&key).unwrap();
        assert_eq!(store.load_identity_private().unwrap(), key);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let path = tmp.path().join("companion").join("identity.key");
            let mode = fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600, "identity key must be owner-only");
        }
        let _ = tmp;
    }

    #[test]
    fn wrong_length_identity_is_ignored() {
        let (tmp, store) = store();
        let path = tmp.path().join("companion").join("identity.key");
        fs::write(&path, [1u8; 16]).unwrap();
        assert!(store.load_identity_private().is_none());
    }

    #[test]
    fn pin_first_use_then_already_pinned() {
        let (_tmp, store) = store();
        let key = [7u8; KEY_LEN];
        let id = "dev-1";
        assert_eq!(store.pin(id, &key, "Phone").unwrap(), PinOutcome::FirstUse);
        assert!(store.is_paired(id));
        assert_eq!(store.pin(id, &key, "Phone").unwrap(), PinOutcome::AlreadyPinned);
        assert_eq!(store.pinned_key(id).unwrap(), key.to_vec());
    }

    #[test]
    fn pin_mismatch_is_rejected() {
        let (_tmp, store) = store();
        store.pin("dev-1", &[1u8; KEY_LEN], "Phone").unwrap();
        assert_eq!(
            store.pin("dev-1", &[2u8; KEY_LEN], "Phone").unwrap_err(),
            DeviceStoreError::TofuMismatch
        );
    }

    #[test]
    fn pin_empty_name_falls_back_to_fingerprint_label() {
        let (_tmp, store) = store();
        store.pin("dev-1", &[3u8; KEY_LEN], "   ").unwrap();
        let dev = &store.list()[0];
        assert!(dev.name.starts_with("device "));
        assert_eq!(dev.fingerprint, short_fingerprint(&[3u8; KEY_LEN]));
    }

    #[test]
    fn revoke_removes_row_and_persists() {
        let (tmp, store) = store();
        store.pin("dev-1", &[1u8; KEY_LEN], "A").unwrap();
        store.pin("dev-2", &[2u8; KEY_LEN], "B").unwrap();
        assert!(store.revoke("dev-1").unwrap());
        assert!(!store.is_paired("dev-1"));
        assert!(store.is_paired("dev-2"));
        // Not removing again returns false.
        assert!(!store.revoke("dev-1").unwrap());

        // Reload from disk: dev-2 survives, dev-1 is gone.
        let reopened = DeviceStore::open(tmp.path().join("companion")).unwrap();
        assert!(reopened.is_paired("dev-2"));
        assert!(!reopened.is_paired("dev-1"));
    }

    #[test]
    fn devices_persist_across_reopen() {
        let (tmp, store) = store();
        store.pin("dev-1", &[5u8; KEY_LEN], "Laptop").unwrap();
        drop(store);
        let reopened = DeviceStore::open(tmp.path().join("companion")).unwrap();
        let list = reopened.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].device_id, "dev-1");
        assert_eq!(list[0].name, "Laptop");
    }

    #[test]
    fn malformed_devices_file_starts_empty() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("companion");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("devices.json"), "{ not json").unwrap();
        let store = DeviceStore::open(dir).unwrap();
        assert!(store.list().is_empty());
        // And a fresh pin heals the file.
        store.pin("dev-1", &[1u8; KEY_LEN], "X").unwrap();
        assert!(store.is_paired("dev-1"));
    }

    #[test]
    fn pinned_key_none_for_unknown_device() {
        let (_tmp, store) = store();
        assert!(store.pinned_key("nope").is_none());
    }
}
