//! Crate-agnostic `PtyHost` for the companion bridge: owns an `Arc<PtyManager>`
//! and a `PtyEventSink`. The desktop builds it with a Tauri sink (so output also
//! tees to the webview's `pty:data` listeners); the headless daemon builds it
//! with `NoopPtySink` (remote clients read via the ring). Replaces the old
//! `ManagedPty<R>`, which reached into Tauri state for the manager.

use std::sync::Arc;

use crate::pty::{PtyEventSink, PtyManager, SpawnParams, Subscription};
use crate::remote::bridge::PtyHost;

pub struct ManagerPtyHost {
    manager: Arc<PtyManager>,
    sink: Arc<dyn PtyEventSink>,
}

impl ManagerPtyHost {
    pub fn new(manager: Arc<PtyManager>, sink: Arc<dyn PtyEventSink>) -> Self {
        Self { manager, sink }
    }
}

impl PtyHost for ManagerPtyHost {
    fn spawn(&self, command: &str, cwd: Option<&str>) -> Result<String, String> {
        self.manager.spawn(
            self.sink.clone(),
            SpawnParams {
                command: command.to_string(),
                args: vec![],
                cwd: cwd.map(str::to_string),
                env: None,
                cols: 80,
                rows: 24,
            },
        )
    }
    fn subscribe(&self, pty_id: &str) -> Option<Subscription> {
        self.manager.subscribe(pty_id)
    }
    fn write(&self, pty_id: &str, data: &str) -> Result<(), String> {
        self.manager.write(pty_id, data)
    }
    fn resize(&self, pty_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        self.manager.resize(pty_id, cols, rows)
    }
    fn kill(&self, pty_id: &str) -> Result<(), String> {
        self.manager.kill(pty_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pty::NoopPtySink;

    // Windows has no /bin/sh; cmd.exe is the always-present interactive shell.
    #[cfg(windows)]
    const TEST_SHELL: &str = "cmd";
    #[cfg(not(windows))]
    const TEST_SHELL: &str = "/bin/sh";

    #[test]
    fn spawn_then_subscribe_then_kill() {
        let host = ManagerPtyHost::new(Arc::new(PtyManager::new()), Arc::new(NoopPtySink));
        let id = host.spawn(TEST_SHELL, None).expect("spawn");
        assert!(host.subscribe(&id).is_some(), "subscribe yields a ring handle");
        host.write(&id, "exit\n").expect("write");
        host.kill(&id).expect("kill");
    }
}
