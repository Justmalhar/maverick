//! Tracks active authenticated remote sessions so `remote_revoke` can tear down
//! every live connection belonging to a revoked device.
//!
//! Each authenticated `serve_paired` connection [`register`](SessionRegistry::register)s
//! itself, getting back a [`SessionHandle`] whose `is_revoked()` the serve loop
//! polls before reading each frame. Revoking a device flips the shared flag for
//! all of that device's handles, so the next loop iteration closes the socket.
//! The handle de-registers on drop, so a normally-closed connection leaves no
//! trace.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// A live session's shared revoke flag, keyed by device id for fan-out.
struct Entry {
    device_id: String,
    revoked: Arc<AtomicBool>,
}

/// Per-connection handle returned by [`SessionRegistry::register`]. Polled by the
/// serve loop; de-registers on drop.
pub struct SessionHandle {
    revoked: Arc<AtomicBool>,
    id: u64,
    registry: Arc<RegistryInner>,
}

impl SessionHandle {
    /// Whether this session's device has been revoked since it was admitted.
    pub fn is_revoked(&self) -> bool {
        self.revoked.load(Ordering::Acquire)
    }
}

impl Drop for SessionHandle {
    fn drop(&mut self) {
        self.registry.remove(self.id);
    }
}

struct RegistryInner {
    next_id: Mutex<u64>,
    entries: Mutex<Vec<(u64, Entry)>>,
}

impl RegistryInner {
    fn remove(&self, id: u64) {
        self.entries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|(eid, _)| *eid != id);
    }
}

/// Registry of active authenticated sessions. Cheap clone (shares the inner state).
#[derive(Clone)]
pub struct SessionRegistry {
    inner: Arc<RegistryInner>,
}

impl Default for SessionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RegistryInner {
                next_id: Mutex::new(0),
                entries: Mutex::new(Vec::new()),
            }),
        }
    }

    /// Register a new live session for `device_id`, returning its handle.
    pub fn register(&self, device_id: &str) -> SessionHandle {
        let revoked = Arc::new(AtomicBool::new(false));
        let mut id_guard = self.inner.next_id.lock().unwrap_or_else(|e| e.into_inner());
        let id = *id_guard;
        *id_guard += 1;
        drop(id_guard);
        self.inner
            .entries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push((id, Entry { device_id: device_id.to_string(), revoked: revoked.clone() }));
        SessionHandle { revoked, id, registry: self.inner.clone() }
    }

    /// Flag every live session for `device_id` as revoked. Returns how many were
    /// flagged (0 if the device had no live sessions).
    pub fn revoke_device(&self, device_id: &str) -> usize {
        let guard = self.inner.entries.lock().unwrap_or_else(|e| e.into_inner());
        let mut n = 0;
        for (_, entry) in guard.iter() {
            if entry.device_id == device_id {
                entry.revoked.store(true, Ordering::Release);
                n += 1;
            }
        }
        n
    }

    /// Current live session count (for tests / status).
    pub fn live_count(&self) -> usize {
        self.inner.entries.lock().unwrap_or_else(|e| e.into_inner()).len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_then_drop_deregisters() {
        let reg = SessionRegistry::new();
        {
            let _h = reg.register("dev-1");
            assert_eq!(reg.live_count(), 1);
        }
        assert_eq!(reg.live_count(), 0);
    }

    #[test]
    fn revoke_flags_only_matching_device() {
        let reg = SessionRegistry::new();
        let a1 = reg.register("dev-a");
        let a2 = reg.register("dev-a");
        let b = reg.register("dev-b");
        assert_eq!(reg.revoke_device("dev-a"), 2);
        assert!(a1.is_revoked());
        assert!(a2.is_revoked());
        assert!(!b.is_revoked());
    }

    #[test]
    fn revoke_unknown_device_flags_nothing() {
        let reg = SessionRegistry::new();
        let _h = reg.register("dev-a");
        assert_eq!(reg.revoke_device("nope"), 0);
    }

    #[test]
    fn handles_get_distinct_ids_and_independent_dropping() {
        let reg = SessionRegistry::new();
        let h1 = reg.register("dev");
        let h2 = reg.register("dev");
        assert_eq!(reg.live_count(), 2);
        drop(h1);
        assert_eq!(reg.live_count(), 1);
        assert!(!h2.is_revoked());
    }
}
