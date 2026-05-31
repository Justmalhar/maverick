//! `RemoteBridge` — decodes each `ClientMessage` and drives the host-side
//! surfaces a companion client can reach today (Companion-3):
//!
//! - **PTY surface** (`list_sessions`/`create_session`/`attach_session`/`input`/
//!   `resize`/`close_session`): backed by the Rust-core [`PtyManager`]. Attach
//!   uses Companion-2's tee — [`PtyManager::subscribe`] hands back a one-lock
//!   snapshot of the most-recent scrollback suffix (`replay`) plus a live
//!   `receiver`; the bridge replays the suffix as a `Scrollback` `ServerMessage`,
//!   then streams every subsequent chunk as `Output`, gaplessly.
//! - **Read-mostly surfaces** (`list_directory`/`git_status`/`git_diff`/
//!   `index_project`): forwarded to the Bun sidecar via
//!   `Sidecar::request("file.tree"|"diff.get"|…)` and reshaped into the
//!   protocol's `DirectoryEntry`/`GitStatus`/`IndexEntry` types. `requestId`
//!   correlation is preserved end-to-end.
//!
//! Deferred to later companions and intentionally NOT wired here:
//! - `create_agent_session`/`switch_session_mode`/`agent_input` →
//!   the `AgentEvent` chat pipeline is **Companion-4**. They return a clear
//!   `Error` so a client gets a definitive answer instead of silence.
//! - `permission_response` → also part of the agent/hook pipeline (C4).
//! - `upload_file` → the upload store is out of C3's read-mostly scope; returns
//!   `FileUploadFailed`.
//!
//! The protocol speaks `Uuid` session ids; the Rust `PtyManager` speaks opaque
//! string ids (`pty_0`). The bridge owns the bijection plus the `SessionInfo`
//! registry, so the wire stays UUID-addressed while the core stays string-addressed.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use chrono::Utc;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::pty::Subscription;
use crate::remote::{
    ClientMessage, DirectoryEntry, GitFileStatus, GitStatus, IndexEntry, ServerMessage, SessionInfo,
};

/// Max diff bytes streamed inline before we flag `truncated`. 1 MiB keeps a
/// single `git_diff_result` frame well under the 16 MiB WS ceiling even after
/// JSON-string escaping.
const DIFF_TRUNCATE_BYTES: usize = 1024 * 1024;

/// Abstraction over `Sidecar::request` so the bridge can be unit-tested with a
/// deterministic fake instead of a live Bun process. `Arc<Sidecar>` implements
/// it (see `impl_sidecar`), forwarding to the real JSON-RPC transport.
#[async_trait]
pub trait SidecarRequest: Send + Sync {
    async fn request(&self, method: &str, params: Value) -> Result<Value, String>;
}

#[async_trait]
impl SidecarRequest for crate::sidecar::Sidecar {
    async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        crate::sidecar::Sidecar::request(self, method, params)
            .await
            .map_err(|e| e.to_string())
    }
}

/// Abstraction over the PTY surface the bridge drives. The production impl wraps
/// the Tauri `PtyManager` + an `AppHandle` (so `spawn` can emit `pty:data` to the
/// local webview too); tests use a fake backed by a seeded `Ring`.
pub trait PtyHost: Send + Sync {
    /// Spawn a shell, returning the core's opaque pty id.
    fn spawn(&self, command: &str, cwd: Option<&str>) -> Result<String, String>;
    /// Subscribe to replay-then-live output for a live pty. `None` if unknown.
    fn subscribe(&self, pty_id: &str) -> Option<Subscription>;
    fn write(&self, pty_id: &str, data: &str) -> Result<(), String>;
    fn resize(&self, pty_id: &str, cols: u16, rows: u16) -> Result<(), String>;
    fn kill(&self, pty_id: &str) -> Result<(), String>;
}

/// One tracked PTY session: its protocol UUID, the core's string id, and the
/// `SessionInfo` we echo back in `session_list`.
struct TrackedSession {
    pty_id: String,
    info: SessionInfo,
}

/// Bytes-to-base64 for the `Output`/`Scrollback` `data` fields, matching the
/// Swift client's `Data(base64Encoded:)` contract.
fn b64(bytes: &[u8]) -> String {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    STANDARD.encode(bytes)
}

/// What `RemoteBridge::handle` produces for one inbound `ClientMessage`: a set of
/// immediate replies to send now, and optionally an attach directive the
/// connection layer turns into a live streaming task.
pub struct BridgeOutcome {
    /// Replies to send on this socket immediately, in order.
    pub replies: Vec<ServerMessage>,
    /// Present for `attach_session`: the subscription to drain as live `Output`,
    /// tagged with the session UUID to stamp on each frame.
    pub attach: Option<AttachDirective>,
}

/// A successful attach: the session to stream and its live tee subscription.
pub struct AttachDirective {
    pub session_id: Uuid,
    pub subscription: Subscription,
}

impl BridgeOutcome {
    fn reply(msg: ServerMessage) -> Self {
        Self { replies: vec![msg], attach: None }
    }
    fn replies(replies: Vec<ServerMessage>) -> Self {
        Self { replies, attach: None }
    }
    fn none() -> Self {
        Self { replies: vec![], attach: None }
    }
}

/// Decodes and routes `ClientMessage`s for one host. Shared across every
/// connection (the session registry is process-wide, mirroring the desktop's
/// single `PtyManager`); each connection owns its own attach lifecycle.
pub struct RemoteBridge {
    sidecar: Arc<dyn SidecarRequest>,
    pty: Arc<dyn PtyHost>,
    sessions: Mutex<HashMap<Uuid, TrackedSession>>,
}

impl RemoteBridge {
    pub fn new(sidecar: Arc<dyn SidecarRequest>, pty: Arc<dyn PtyHost>) -> Self {
        Self {
            sidecar,
            pty,
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// Resolve a protocol session UUID to the core's pty string id.
    fn pty_id_of(&self, session_id: &Uuid) -> Option<String> {
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(session_id)
            .map(|s| s.pty_id.clone())
    }

    fn session_list(&self) -> ServerMessage {
        let sessions = self
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .map(|s| s.info.clone())
            .collect();
        ServerMessage::SessionList { sessions }
    }

    /// Decode + route a single message. Pure async; the only side effects are on
    /// the shared session registry and the injected `PtyHost`/`SidecarRequest`.
    pub async fn handle(&self, msg: ClientMessage) -> BridgeOutcome {
        match msg {
            ClientMessage::ListSessions => BridgeOutcome::reply(self.session_list()),

            ClientMessage::CreateSession { name, shell, cwd } => {
                self.create_session(name, shell, cwd)
            }

            ClientMessage::AttachSession { session_id } => self.attach(session_id),

            ClientMessage::Input { session_id, data } => {
                match self.pty_id_of(&session_id) {
                    Some(pty_id) => match self.pty.write(&pty_id, &data) {
                        Ok(()) => BridgeOutcome::none(),
                        Err(e) => BridgeOutcome::reply(ServerMessage::Error { message: e }),
                    },
                    None => BridgeOutcome::reply(ServerMessage::Error {
                        message: format!("unknown session {session_id}"),
                    }),
                }
            }

            ClientMessage::Resize { session_id, cols, rows } => {
                match self.pty_id_of(&session_id) {
                    Some(pty_id) => {
                        let r = self.pty.resize(&pty_id, clamp_u16(cols), clamp_u16(rows));
                        match r {
                            Ok(()) => BridgeOutcome::none(),
                            Err(e) => BridgeOutcome::reply(ServerMessage::Error { message: e }),
                        }
                    }
                    None => BridgeOutcome::reply(ServerMessage::Error {
                        message: format!("unknown session {session_id}"),
                    }),
                }
            }

            ClientMessage::CloseSession { session_id } => self.close_session(session_id),

            ClientMessage::ListDirectory { request_id, path } => {
                self.list_directory(request_id, path).await
            }

            ClientMessage::GitStatus { request_id, path } => {
                self.git_status(request_id, path).await
            }

            ClientMessage::GitDiff { request_id, path, file, staged } => {
                self.git_diff(request_id, path, file, staged).await
            }

            ClientMessage::IndexProject { request_id, path, refresh } => {
                self.index_project(request_id, path, refresh).await
            }

            // Deferred to Companion-4 (agent chat / AgentEvent pipeline).
            ClientMessage::CreateAgentSession { .. }
            | ClientMessage::SwitchSessionMode { .. }
            | ClientMessage::AgentInput { .. }
            | ClientMessage::PermissionResponse { .. } => {
                BridgeOutcome::reply(ServerMessage::Error {
                    message: "agent sessions are not yet implemented (Companion-4)".into(),
                })
            }

            // Upload store is out of Companion-3's read-mostly scope.
            ClientMessage::UploadFile { upload_id, .. } => {
                BridgeOutcome::reply(ServerMessage::FileUploadFailed {
                    upload_id,
                    message: "file upload is not yet implemented (Companion-3)".into(),
                })
            }
        }
    }

    fn create_session(
        &self,
        name: String,
        shell: String,
        cwd: Option<String>,
    ) -> BridgeOutcome {
        let command = if shell.trim().is_empty() {
            "/bin/zsh".to_string()
        } else {
            shell.clone()
        };
        let pty_id = match self.pty.spawn(&command, cwd.as_deref()) {
            Ok(id) => id,
            Err(e) => return BridgeOutcome::reply(ServerMessage::Error { message: e }),
        };

        let id = Uuid::new_v4();
        let info = SessionInfo {
            id,
            name,
            shell: command,
            created_at: Utc::now(),
            agent_provider: None,
            session_mode: None,
        };
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, TrackedSession { pty_id, info: info.clone() });

        // Mirror the Swift lifecycle: created → updated list → auto-attach.
        let mut out = BridgeOutcome::replies(vec![
            ServerMessage::SessionCreated { session: info },
            self.session_list(),
        ]);
        let attach = self.attach(id);
        out.replies.extend(attach.replies);
        out.attach = attach.attach;
        out
    }

    fn attach(&self, session_id: Uuid) -> BridgeOutcome {
        let pty_id = match self.pty_id_of(&session_id) {
            Some(id) => id,
            None => {
                return BridgeOutcome::reply(ServerMessage::Error {
                    message: format!("unknown session {session_id}"),
                })
            }
        };
        let sub = match self.pty.subscribe(&pty_id) {
            Some(s) => s,
            None => {
                // The pty died between registration and attach; drop our tracking
                // so list_sessions reflects reality, and tell the client.
                self.sessions
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&session_id);
                return BridgeOutcome::replies(vec![
                    ServerMessage::SessionClosed { session_id },
                    self.session_list(),
                ]);
            }
        };

        // Replay the scrollback suffix first (gapless: the live receiver in `sub`
        // carries only what was appended AFTER this snapshot — Companion-2's tee
        // guarantees no overlap, no hole between replay and live).
        let mut replies = Vec::new();
        if !sub.replay.is_empty() {
            replies.push(ServerMessage::Scrollback {
                session_id,
                data: b64(&sub.replay),
            });
        }
        BridgeOutcome {
            replies,
            attach: Some(AttachDirective { session_id, subscription: sub }),
        }
    }

    fn close_session(&self, session_id: Uuid) -> BridgeOutcome {
        let pty_id = self
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&session_id)
            .map(|s| s.pty_id);
        if let Some(pty_id) = pty_id {
            let _ = self.pty.kill(&pty_id);
        }
        BridgeOutcome::replies(vec![
            ServerMessage::SessionClosed { session_id },
            self.session_list(),
        ])
    }

    // ---- Read-mostly surfaces (sidecar-backed, reshaped to protocol types) ----

    async fn list_directory(&self, request_id: Uuid, path: Option<String>) -> BridgeOutcome {
        let root = path.unwrap_or_else(default_home);
        match self.sidecar.request("file.tree", json!({ "worktreePath": root })).await {
            Ok(value) => {
                let entries = reshape_directory(&value);
                BridgeOutcome::reply(ServerMessage::DirectoryListing {
                    request_id,
                    path: root,
                    entries,
                })
            }
            Err(message) => {
                BridgeOutcome::reply(ServerMessage::DirectoryListingFailed { request_id, message })
            }
        }
    }

    async fn git_status(&self, request_id: Uuid, path: String) -> BridgeOutcome {
        // No single sidecar `git.status`; compose branch info (git.branch_list)
        // with the per-file porcelain that `file.tree` already collects.
        let branch_res = self
            .sidecar
            .request("git.branch_list", json!({ "worktreePath": path }))
            .await;
        let tree_res = self
            .sidecar
            .request("file.tree", json!({ "worktreePath": path }))
            .await;

        match tree_res {
            Ok(tree) => {
                let files = reshape_git_files(&tree);
                let (branch, ahead, behind, is_repo) = match &branch_res {
                    Ok(b) => reshape_branch(b),
                    // branch_list failing (not a repo / git error) → degrade to a
                    // non-repo status rather than failing the whole call when the
                    // tree still resolved.
                    Err(_) => (None, 0, 0, false),
                };
                let status = GitStatus {
                    is_repo: is_repo || !files.is_empty() || branch.is_some(),
                    branch,
                    ahead,
                    behind,
                    files,
                };
                BridgeOutcome::reply(ServerMessage::GitStatusResult { request_id, status })
            }
            Err(message) => {
                BridgeOutcome::reply(ServerMessage::GitStatusFailed { request_id, message })
            }
        }
    }

    async fn git_diff(
        &self,
        request_id: Uuid,
        path: String,
        file: String,
        staged: bool,
    ) -> BridgeOutcome {
        let params = json!({ "worktreePath": path, "filePath": file, "staged": staged });
        match self.sidecar.request("diff.get", params).await {
            Ok(value) => {
                let (mut diff, _) = reshape_diff(&value, &file);
                let truncated = diff.len() > DIFF_TRUNCATE_BYTES;
                if truncated {
                    diff.truncate(DIFF_TRUNCATE_BYTES);
                }
                BridgeOutcome::reply(ServerMessage::GitDiffResult {
                    request_id,
                    file,
                    diff,
                    truncated,
                })
            }
            Err(message) => {
                BridgeOutcome::reply(ServerMessage::GitDiffFailed { request_id, message })
            }
        }
    }

    async fn index_project(
        &self,
        request_id: Uuid,
        path: String,
        _refresh: bool,
    ) -> BridgeOutcome {
        match self.sidecar.request("file.tree", json!({ "worktreePath": path })).await {
            Ok(value) => {
                let entries = reshape_index(&value);
                // Single-shot: the whole tree fits one chunk for C3. Chunked
                // streaming of huge trees is a later refinement.
                BridgeOutcome::reply(ServerMessage::IndexChunk {
                    request_id,
                    root: path,
                    entries,
                    complete: true,
                })
            }
            Err(message) => BridgeOutcome::reply(ServerMessage::IndexFailed { request_id, message }),
        }
    }
}

fn clamp_u16(v: i64) -> u16 {
    v.clamp(1, u16::MAX as i64) as u16
}

fn default_home() -> String {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "/".into())
}

// ---- Sidecar result reshapers (sidecar JSON → protocol types) ----

/// `file.tree` returns a recursive `FileEntry[]` with `{name,isDirectory,...}`.
/// A directory listing is the top level only (name + isDirectory + isHidden).
fn reshape_directory(value: &Value) -> Vec<DirectoryEntry> {
    value
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|e| {
                    let name = e.get("name")?.as_str()?.to_string();
                    let is_directory = e.get("isDirectory").and_then(Value::as_bool).unwrap_or(false);
                    let is_hidden = name.starts_with('.');
                    Some(DirectoryEntry { name, is_directory, is_hidden })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Flatten the recursive `file.tree` into `IndexEntry[]` (path + isDirectory).
fn reshape_index(value: &Value) -> Vec<IndexEntry> {
    let mut out = Vec::new();
    collect_index(value, &mut out);
    out
}

fn collect_index(value: &Value, out: &mut Vec<IndexEntry>) {
    if let Some(arr) = value.as_array() {
        for e in arr {
            let Some(path) = e.get("path").and_then(Value::as_str) else {
                continue;
            };
            let is_directory = e.get("isDirectory").and_then(Value::as_bool).unwrap_or(false);
            out.push(IndexEntry { path: path.to_string(), is_directory, size: None });
            if let Some(children) = e.get("children") {
                collect_index(children, out);
            }
        }
    }
}

/// Walk the recursive `file.tree` collecting every entry that carries a git
/// porcelain `status` into the flat `GitFileStatus[]` the protocol expects.
fn reshape_git_files(value: &Value) -> Vec<GitFileStatus> {
    let mut out = Vec::new();
    collect_git_files(value, &mut out);
    out
}

fn collect_git_files(value: &Value, out: &mut Vec<GitFileStatus>) {
    if let Some(arr) = value.as_array() {
        for e in arr {
            if let (Some(path), Some(status)) = (
                e.get("path").and_then(Value::as_str),
                e.get("status").and_then(Value::as_str),
            ) {
                out.push(GitFileStatus {
                    path: path.to_string(),
                    status: status.to_string(),
                    // file.tree's porcelain folds index+worktree into one code; we
                    // surface working-tree changes (staged hunk granularity is the
                    // diff surface's job, not the status summary's).
                    staged: false,
                });
            }
            if let Some(children) = e.get("children") {
                collect_git_files(children, out);
            }
        }
    }
}

/// `git.branch_list` returns `Branch[]`; pull out the current branch + its
/// ahead/behind. Returns `(branch, ahead, behind, is_repo)`.
fn reshape_branch(value: &Value) -> (Option<String>, i64, i64, bool) {
    let Some(arr) = value.as_array() else {
        return (None, 0, 0, false);
    };
    let is_repo = !arr.is_empty();
    for b in arr {
        if b.get("isCurrent").and_then(Value::as_bool).unwrap_or(false) {
            let name = b.get("name").and_then(Value::as_str).map(str::to_string);
            let ahead = b.get("ahead").and_then(Value::as_i64).unwrap_or(0);
            let behind = b.get("behind").and_then(Value::as_i64).unwrap_or(0);
            return (name, ahead, behind, true);
        }
    }
    (None, 0, 0, is_repo)
}

/// `diff.get` returns `{ files: DiffFile[] }`; reconstruct a unified-diff text
/// for `file` from its hunk patches. Returns `(diff_text, found)`.
fn reshape_diff(value: &Value, file: &str) -> (String, bool) {
    let Some(files) = value.get("files").and_then(Value::as_array) else {
        return (String::new(), false);
    };
    let mut diff = String::new();
    let mut found = false;
    for f in files {
        let path = f.get("path").and_then(Value::as_str).unwrap_or("");
        // Empty `file` means "whole worktree"; otherwise match the requested path.
        if !file.is_empty() && path != file {
            continue;
        }
        found = true;
        if let Some(hunks) = f.get("hunks").and_then(Value::as_array) {
            for h in hunks {
                if let Some(patch) = h.get("patch").and_then(Value::as_str) {
                    if !diff.is_empty() && !diff.ends_with('\n') {
                        diff.push('\n');
                    }
                    diff.push_str(patch);
                }
            }
        }
    }
    (diff, found)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pty::Ring;
    use std::sync::atomic::{AtomicUsize, Ordering};

    // ---- Fakes -------------------------------------------------------------

    /// Records the (method, params) of every sidecar call and returns canned
    /// replies keyed by method.
    struct FakeSidecar {
        replies: HashMap<String, Result<Value, String>>,
        calls: Mutex<Vec<(String, Value)>>,
    }

    impl FakeSidecar {
        fn new() -> Self {
            Self { replies: HashMap::new(), calls: Mutex::new(Vec::new()) }
        }
        fn with(mut self, method: &str, reply: Result<Value, String>) -> Self {
            self.replies.insert(method.to_string(), reply);
            self
        }
    }

    #[async_trait]
    impl SidecarRequest for FakeSidecar {
        async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
            self.calls.lock().unwrap().push((method.to_string(), params));
            self.replies
                .get(method)
                .cloned()
                .unwrap_or_else(|| Err(format!("no fake reply for {method}")))
        }
    }

    /// In-memory PTY host: each spawned id gets a `Ring` we can push into to
    /// drive replay/live without a real pseudo-terminal or AppHandle.
    struct FakePty {
        rings: Mutex<HashMap<String, Ring>>,
        counter: AtomicUsize,
        writes: Mutex<Vec<(String, String)>>,
        resizes: Mutex<Vec<(String, u16, u16)>>,
        kills: Mutex<Vec<String>>,
        spawn_fails: bool,
    }

    impl FakePty {
        fn new() -> Self {
            Self {
                rings: Mutex::new(HashMap::new()),
                counter: AtomicUsize::new(0),
                writes: Mutex::new(Vec::new()),
                resizes: Mutex::new(Vec::new()),
                kills: Mutex::new(Vec::new()),
                spawn_fails: false,
            }
        }
        fn ring(&self, pty_id: &str) -> Ring {
            self.rings.lock().unwrap().get(pty_id).unwrap().clone()
        }
    }

    impl PtyHost for FakePty {
        fn spawn(&self, _command: &str, _cwd: Option<&str>) -> Result<String, String> {
            if self.spawn_fails {
                return Err("spawn boom".into());
            }
            let id = format!("pty_{}", self.counter.fetch_add(1, Ordering::SeqCst));
            self.rings.lock().unwrap().insert(id.clone(), Ring::new());
            Ok(id)
        }
        fn subscribe(&self, pty_id: &str) -> Option<Subscription> {
            self.rings.lock().unwrap().get(pty_id).map(|r| r.subscribe())
        }
        fn write(&self, pty_id: &str, data: &str) -> Result<(), String> {
            self.writes.lock().unwrap().push((pty_id.to_string(), data.to_string()));
            Ok(())
        }
        fn resize(&self, pty_id: &str, cols: u16, rows: u16) -> Result<(), String> {
            self.resizes.lock().unwrap().push((pty_id.to_string(), cols, rows));
            Ok(())
        }
        fn kill(&self, pty_id: &str) -> Result<(), String> {
            self.kills.lock().unwrap().push(pty_id.to_string());
            Ok(())
        }
    }

    fn bridge(sidecar: impl SidecarRequest + 'static, pty: Arc<FakePty>) -> RemoteBridge {
        RemoteBridge::new(Arc::new(sidecar), pty)
    }

    fn b64_decode(s: &str) -> Vec<u8> {
        use base64::engine::general_purpose::STANDARD;
        use base64::Engine;
        STANDARD.decode(s).unwrap()
    }

    // ---- PTY surface -------------------------------------------------------

    #[tokio::test]
    async fn list_sessions_empty_then_after_create() {
        let pty = Arc::new(FakePty::new());
        let b = bridge(FakeSidecar::new(), pty.clone());

        let out = b.handle(ClientMessage::ListSessions).await;
        match &out.replies[0] {
            ServerMessage::SessionList { sessions } => assert!(sessions.is_empty()),
            other => panic!("expected SessionList, got {other:?}"),
        }

        let out = b
            .handle(ClientMessage::CreateSession {
                name: "main".into(),
                shell: "/bin/zsh".into(),
                cwd: None,
            })
            .await;
        // created + list + (attach has empty replay → no scrollback) + attach directive.
        assert!(matches!(out.replies[0], ServerMessage::SessionCreated { .. }));
        assert!(matches!(out.replies[1], ServerMessage::SessionList { .. }));
        assert!(out.attach.is_some(), "create auto-attaches");

        let out = b.handle(ClientMessage::ListSessions).await;
        match &out.replies[0] {
            ServerMessage::SessionList { sessions } => {
                assert_eq!(sessions.len(), 1);
                assert_eq!(sessions[0].name, "main");
                assert!(sessions[0].agent_provider.is_none());
            }
            other => panic!("expected SessionList, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn create_session_empty_shell_defaults_to_zsh() {
        let pty = Arc::new(FakePty::new());
        let b = bridge(FakeSidecar::new(), pty.clone());
        let out = b
            .handle(ClientMessage::CreateSession { name: "s".into(), shell: "  ".into(), cwd: None })
            .await;
        match &out.replies[0] {
            ServerMessage::SessionCreated { session } => assert_eq!(session.shell, "/bin/zsh"),
            other => panic!("got {other:?}"),
        }
    }

    #[tokio::test]
    async fn create_session_spawn_failure_returns_error() {
        let mut pty = FakePty::new();
        pty.spawn_fails = true;
        let pty = Arc::new(pty);
        let b = bridge(FakeSidecar::new(), pty.clone());
        let out = b
            .handle(ClientMessage::CreateSession { name: "s".into(), shell: "/bin/zsh".into(), cwd: None })
            .await;
        assert!(matches!(out.replies[0], ServerMessage::Error { .. }));
        assert!(out.attach.is_none());
    }

    #[tokio::test]
    async fn attach_replays_scrollback_then_streams_live_gaplessly() {
        let pty = Arc::new(FakePty::new());
        let b = bridge(FakeSidecar::new(), pty.clone());

        // Create a session, then find its UUID + pty id from the registry.
        let created = b
            .handle(ClientMessage::CreateSession { name: "s".into(), shell: "sh".into(), cwd: None })
            .await;
        let session_id = match &created.replies[0] {
            ServerMessage::SessionCreated { session } => session.id,
            other => panic!("got {other:?}"),
        };
        // The auto-attach gave us a subscription; the pty id is pty_0.
        let ring = pty.ring("pty_0");
        // Seed history BEFORE a fresh attach so the replay is non-empty.
        ring.push(b"HISTORY");

        let out = b.handle(ClientMessage::AttachSession { session_id }).await;
        // First reply is the scrollback suffix, base64-encoded.
        match &out.replies[0] {
            ServerMessage::Scrollback { session_id: sid, data } => {
                assert_eq!(*sid, session_id);
                assert_eq!(b64_decode(data), b"HISTORY");
            }
            other => panic!("expected Scrollback, got {other:?}"),
        }
        let directive = out.attach.expect("attach yields a live subscription");
        assert_eq!(directive.subscription.replay, b"HISTORY");

        // Live bytes pushed after the snapshot arrive on the receiver only once
        // (no overlap with replay) — the Companion-2 gapless guarantee.
        ring.push(b"LIVE");
        let live = directive.subscription.receiver.recv().unwrap();
        assert_eq!(live, b"LIVE");
    }

    #[tokio::test]
    async fn attach_unknown_session_errors() {
        let pty = Arc::new(FakePty::new());
        let b = bridge(FakeSidecar::new(), pty);
        let out = b.handle(ClientMessage::AttachSession { session_id: Uuid::new_v4() }).await;
        assert!(matches!(out.replies[0], ServerMessage::Error { .. }));
    }

    #[tokio::test]
    async fn attach_when_pty_gone_closes_and_untracks() {
        let pty = Arc::new(FakePty::new());
        let b = bridge(FakeSidecar::new(), pty.clone());
        let created = b
            .handle(ClientMessage::CreateSession { name: "s".into(), shell: "sh".into(), cwd: None })
            .await;
        let session_id = match &created.replies[0] {
            ServerMessage::SessionCreated { session } => session.id,
            _ => unreachable!(),
        };
        // Simulate the pty dying: drop its ring so subscribe() returns None.
        pty.rings.lock().unwrap().remove("pty_0");

        let out = b.handle(ClientMessage::AttachSession { session_id }).await;
        assert!(matches!(out.replies[0], ServerMessage::SessionClosed { .. }));
        // And it is no longer listed.
        let listed = b.handle(ClientMessage::ListSessions).await;
        match &listed.replies[0] {
            ServerMessage::SessionList { sessions } => assert!(sessions.is_empty()),
            _ => unreachable!(),
        }
    }

    #[tokio::test]
    async fn input_resize_route_to_pty_and_close_kills() {
        let pty = Arc::new(FakePty::new());
        let b = bridge(FakeSidecar::new(), pty.clone());
        let created = b
            .handle(ClientMessage::CreateSession { name: "s".into(), shell: "sh".into(), cwd: None })
            .await;
        let session_id = match &created.replies[0] {
            ServerMessage::SessionCreated { session } => session.id,
            _ => unreachable!(),
        };

        let out = b.handle(ClientMessage::Input { session_id, data: "ls\n".into() }).await;
        assert!(out.replies.is_empty() && out.attach.is_none());
        assert_eq!(pty.writes.lock().unwrap()[0], ("pty_0".into(), "ls\n".into()));

        let out = b.handle(ClientMessage::Resize { session_id, cols: 120, rows: 40 }).await;
        assert!(out.replies.is_empty());
        assert_eq!(pty.resizes.lock().unwrap()[0], ("pty_0".into(), 120, 40));

        let out = b.handle(ClientMessage::CloseSession { session_id }).await;
        assert!(matches!(out.replies[0], ServerMessage::SessionClosed { .. }));
        assert_eq!(pty.kills.lock().unwrap()[0], "pty_0");
        // After close it is untracked.
        let listed = b.handle(ClientMessage::ListSessions).await;
        match &listed.replies[0] {
            ServerMessage::SessionList { sessions } => assert!(sessions.is_empty()),
            _ => unreachable!(),
        }
    }

    #[tokio::test]
    async fn input_and_resize_unknown_session_error() {
        let pty = Arc::new(FakePty::new());
        let b = bridge(FakeSidecar::new(), pty);
        let id = Uuid::new_v4();
        let out = b.handle(ClientMessage::Input { session_id: id, data: "x".into() }).await;
        assert!(matches!(out.replies[0], ServerMessage::Error { .. }));
        let out = b.handle(ClientMessage::Resize { session_id: id, cols: 80, rows: 24 }).await;
        assert!(matches!(out.replies[0], ServerMessage::Error { .. }));
    }

    #[tokio::test]
    async fn resize_clamps_out_of_range_dimensions() {
        let pty = Arc::new(FakePty::new());
        let b = bridge(FakeSidecar::new(), pty.clone());
        let created = b
            .handle(ClientMessage::CreateSession { name: "s".into(), shell: "sh".into(), cwd: None })
            .await;
        let session_id = match &created.replies[0] {
            ServerMessage::SessionCreated { session } => session.id,
            _ => unreachable!(),
        };
        // 0 clamps to 1; > u16::MAX clamps to u16::MAX.
        b.handle(ClientMessage::Resize { session_id, cols: 0, rows: 999_999 }).await;
        assert_eq!(pty.resizes.lock().unwrap()[0], ("pty_0".into(), 1, u16::MAX));
    }

    #[tokio::test]
    async fn close_unknown_session_still_reports_closed() {
        let pty = Arc::new(FakePty::new());
        let b = bridge(FakeSidecar::new(), pty.clone());
        let id = Uuid::new_v4();
        let out = b.handle(ClientMessage::CloseSession { session_id: id }).await;
        assert!(matches!(out.replies[0], ServerMessage::SessionClosed { .. }));
        assert!(pty.kills.lock().unwrap().is_empty(), "no pty to kill");
    }

    // ---- Read-mostly surfaces ---------------------------------------------

    #[tokio::test]
    async fn list_directory_reshapes_file_tree_and_marks_hidden() {
        let tree = json!([
            { "name": "src", "path": "src", "isDirectory": true },
            { "name": ".env", "path": ".env", "isDirectory": false },
            { "name": "README.md", "path": "README.md", "isDirectory": false },
        ]);
        let sidecar = FakeSidecar::new().with("file.tree", Ok(tree));
        let b = bridge(sidecar, Arc::new(FakePty::new()));
        let req = Uuid::new_v4();
        let out = b
            .handle(ClientMessage::ListDirectory { request_id: req, path: Some("/repo".into()) })
            .await;
        match &out.replies[0] {
            ServerMessage::DirectoryListing { request_id, path, entries } => {
                assert_eq!(*request_id, req);
                assert_eq!(path, "/repo");
                assert_eq!(entries.len(), 3);
                let env = entries.iter().find(|e| e.name == ".env").unwrap();
                assert!(env.is_hidden && !env.is_directory);
                let src = entries.iter().find(|e| e.name == "src").unwrap();
                assert!(src.is_directory && !src.is_hidden);
            }
            other => panic!("got {other:?}"),
        }
    }

    #[tokio::test]
    async fn list_directory_default_path_when_omitted() {
        let sidecar = FakeSidecar::new().with("file.tree", Ok(json!([])));
        let b = bridge(sidecar, Arc::new(FakePty::new()));
        let out = b
            .handle(ClientMessage::ListDirectory { request_id: Uuid::nil(), path: None })
            .await;
        assert!(matches!(out.replies[0], ServerMessage::DirectoryListing { .. }));
    }

    #[tokio::test]
    async fn list_directory_failure_maps_to_failed() {
        let sidecar = FakeSidecar::new().with("file.tree", Err("nope".into()));
        let b = bridge(sidecar, Arc::new(FakePty::new()));
        let req = Uuid::new_v4();
        let out = b
            .handle(ClientMessage::ListDirectory { request_id: req, path: Some("/x".into()) })
            .await;
        match &out.replies[0] {
            ServerMessage::DirectoryListingFailed { request_id, message } => {
                assert_eq!(*request_id, req);
                assert_eq!(message, "nope");
            }
            other => panic!("got {other:?}"),
        }
    }

    #[tokio::test]
    async fn git_status_composes_branch_and_porcelain() {
        let branches = json!([
            { "name": "main", "isRemote": false, "isCurrent": false },
            { "name": "dev", "isRemote": false, "isCurrent": true, "ahead": 2, "behind": 1 },
        ]);
        let tree = json!([
            { "name": "a.rs", "path": "src/a.rs", "isDirectory": false, "status": "M" },
            { "name": "src", "path": "src", "isDirectory": true, "children": [
                { "name": "b.rs", "path": "src/b.rs", "isDirectory": false, "status": "A" }
            ]},
            { "name": "clean.rs", "path": "clean.rs", "isDirectory": false },
        ]);
        let sidecar = FakeSidecar::new()
            .with("git.branch_list", Ok(branches))
            .with("file.tree", Ok(tree));
        let b = bridge(sidecar, Arc::new(FakePty::new()));
        let req = Uuid::new_v4();
        let out = b.handle(ClientMessage::GitStatus { request_id: req, path: "/repo".into() }).await;
        match &out.replies[0] {
            ServerMessage::GitStatusResult { request_id, status } => {
                assert_eq!(*request_id, req);
                assert!(status.is_repo);
                assert_eq!(status.branch.as_deref(), Some("dev"));
                assert_eq!(status.ahead, 2);
                assert_eq!(status.behind, 1);
                // Both changed files, including the nested one; clean file excluded.
                assert_eq!(status.files.len(), 2);
                assert!(status.files.iter().any(|f| f.path == "src/a.rs" && f.status == "M"));
                assert!(status.files.iter().any(|f| f.path == "src/b.rs" && f.status == "A"));
            }
            other => panic!("got {other:?}"),
        }
    }

    #[tokio::test]
    async fn git_status_tree_failure_maps_to_failed() {
        let sidecar = FakeSidecar::new()
            .with("git.branch_list", Ok(json!([])))
            .with("file.tree", Err("not a git repo".into()));
        let b = bridge(sidecar, Arc::new(FakePty::new()));
        let out = b.handle(ClientMessage::GitStatus { request_id: Uuid::nil(), path: "/x".into() }).await;
        match &out.replies[0] {
            ServerMessage::GitStatusFailed { message, .. } => assert_eq!(message, "not a git repo"),
            other => panic!("got {other:?}"),
        }
    }

    #[tokio::test]
    async fn git_status_branch_failure_degrades_to_non_repo() {
        // branch_list errored but tree resolved (empty) → is_repo=false, no branch.
        let sidecar = FakeSidecar::new()
            .with("git.branch_list", Err("fatal".into()))
            .with("file.tree", Ok(json!([])));
        let b = bridge(sidecar, Arc::new(FakePty::new()));
        let out = b.handle(ClientMessage::GitStatus { request_id: Uuid::nil(), path: "/x".into() }).await;
        match &out.replies[0] {
            ServerMessage::GitStatusResult { status, .. } => {
                assert!(!status.is_repo);
                assert!(status.branch.is_none());
                assert!(status.files.is_empty());
            }
            other => panic!("got {other:?}"),
        }
    }

    #[tokio::test]
    async fn git_status_no_current_branch_still_repo_when_files_present() {
        let branches = json!([{ "name": "main", "isCurrent": false }]);
        let tree = json!([{ "name": "x", "path": "x", "isDirectory": false, "status": "M" }]);
        let sidecar = FakeSidecar::new()
            .with("git.branch_list", Ok(branches))
            .with("file.tree", Ok(tree));
        let b = bridge(sidecar, Arc::new(FakePty::new()));
        let out = b.handle(ClientMessage::GitStatus { request_id: Uuid::nil(), path: "/r".into() }).await;
        match &out.replies[0] {
            ServerMessage::GitStatusResult { status, .. } => {
                // No current branch, but the branch list is non-empty → repo.
                assert!(status.is_repo);
                assert!(status.branch.is_none());
                assert_eq!(status.files.len(), 1);
            }
            other => panic!("got {other:?}"),
        }
    }

    #[tokio::test]
    async fn git_diff_concatenates_hunk_patches_for_file() {
        let diff = json!({
            "files": [
                { "path": "a.rs", "status": "M", "additions": 1, "deletions": 0, "hunks": [
                    { "header": "@@ -1 +1 @@", "lines": [], "patch": "@@ -1 +1 @@\n-old\n+new\n" }
                ]},
                { "path": "other.rs", "status": "M", "hunks": [
                    { "header": "x", "lines": [], "patch": "SHOULD_NOT_APPEAR" }
                ]}
            ]
        });
        let sidecar = FakeSidecar::new().with("diff.get", Ok(diff));
        let b = bridge(sidecar, Arc::new(FakePty::new()));
        let req = Uuid::new_v4();
        let out = b
            .handle(ClientMessage::GitDiff {
                request_id: req,
                path: "/repo".into(),
                file: "a.rs".into(),
                staged: false,
            })
            .await;
        match &out.replies[0] {
            ServerMessage::GitDiffResult { request_id, file, diff, truncated } => {
                assert_eq!(*request_id, req);
                assert_eq!(file, "a.rs");
                assert!(diff.contains("+new"));
                assert!(!diff.contains("SHOULD_NOT_APPEAR"), "only the requested file");
                assert!(!truncated);
            }
            other => panic!("got {other:?}"),
        }
    }

    #[tokio::test]
    async fn git_diff_failure_maps_to_failed() {
        let sidecar = FakeSidecar::new().with("diff.get", Err("bad".into()));
        let b = bridge(sidecar, Arc::new(FakePty::new()));
        let out = b
            .handle(ClientMessage::GitDiff {
                request_id: Uuid::nil(),
                path: "/r".into(),
                file: "a".into(),
                staged: true,
            })
            .await;
        assert!(matches!(out.replies[0], ServerMessage::GitDiffFailed { .. }));
    }

    #[tokio::test]
    async fn git_diff_truncates_oversize_payload() {
        let big = "x".repeat(DIFF_TRUNCATE_BYTES + 1000);
        let diff = json!({
            "files": [
                { "path": "a.rs", "hunks": [ { "patch": big } ] }
            ]
        });
        let sidecar = FakeSidecar::new().with("diff.get", Ok(diff));
        let b = bridge(sidecar, Arc::new(FakePty::new()));
        let out = b
            .handle(ClientMessage::GitDiff {
                request_id: Uuid::nil(),
                path: "/r".into(),
                file: "a.rs".into(),
                staged: false,
            })
            .await;
        match &out.replies[0] {
            ServerMessage::GitDiffResult { diff, truncated, .. } => {
                assert!(*truncated);
                assert_eq!(diff.len(), DIFF_TRUNCATE_BYTES);
            }
            other => panic!("got {other:?}"),
        }
    }

    #[tokio::test]
    async fn index_project_flattens_tree_into_chunk() {
        let tree = json!([
            { "name": "src", "path": "src", "isDirectory": true, "children": [
                { "name": "a.rs", "path": "src/a.rs", "isDirectory": false }
            ]},
            { "name": "README.md", "path": "README.md", "isDirectory": false }
        ]);
        let sidecar = FakeSidecar::new().with("file.tree", Ok(tree));
        let b = bridge(sidecar, Arc::new(FakePty::new()));
        let req = Uuid::new_v4();
        let out = b
            .handle(ClientMessage::IndexProject { request_id: req, path: "/repo".into(), refresh: true })
            .await;
        match &out.replies[0] {
            ServerMessage::IndexChunk { request_id, root, entries, complete } => {
                assert_eq!(*request_id, req);
                assert_eq!(root, "/repo");
                assert!(*complete);
                let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
                assert!(paths.contains(&"src"));
                assert!(paths.contains(&"src/a.rs"));
                assert!(paths.contains(&"README.md"));
            }
            other => panic!("got {other:?}"),
        }
    }

    #[tokio::test]
    async fn index_project_failure_maps_to_failed() {
        let sidecar = FakeSidecar::new().with("file.tree", Err("io".into()));
        let b = bridge(sidecar, Arc::new(FakePty::new()));
        let out = b
            .handle(ClientMessage::IndexProject { request_id: Uuid::nil(), path: "/r".into(), refresh: false })
            .await;
        assert!(matches!(out.replies[0], ServerMessage::IndexFailed { .. }));
    }

    // ---- Deferred / out-of-scope surfaces ----------------------------------

    #[tokio::test]
    async fn agent_messages_return_not_implemented_error() {
        let b = bridge(FakeSidecar::new(), Arc::new(FakePty::new()));
        for msg in [
            ClientMessage::CreateAgentSession {
                name: "a".into(),
                provider: crate::remote::AgentProvider::ClaudeCode,
                cwd: None,
            },
            ClientMessage::SwitchSessionMode {
                session_id: Uuid::nil(),
                mode: crate::remote::SessionMode::Chat,
            },
            ClientMessage::AgentInput { session_id: Uuid::nil(), text: "hi".into() },
            ClientMessage::PermissionResponse {
                session_id: Uuid::nil(),
                request_id: Uuid::nil(),
                allowed: true,
            },
        ] {
            let out = b.handle(msg).await;
            match &out.replies[0] {
                ServerMessage::Error { message } => assert!(message.contains("Companion-4")),
                other => panic!("expected Error, got {other:?}"),
            }
        }
    }

    #[tokio::test]
    async fn upload_file_returns_failed_with_correlation() {
        let b = bridge(FakeSidecar::new(), Arc::new(FakePty::new()));
        let upload_id = Uuid::new_v4();
        let out = b
            .handle(ClientMessage::UploadFile {
                upload_id,
                filename: "x.bin".into(),
                data: vec![1, 2, 3],
            })
            .await;
        match &out.replies[0] {
            ServerMessage::FileUploadFailed { upload_id: uid, message } => {
                assert_eq!(*uid, upload_id);
                assert!(message.contains("Companion-3"));
            }
            other => panic!("got {other:?}"),
        }
    }

    // ---- Reshaper unit edges -----------------------------------------------

    #[test]
    fn reshape_directory_ignores_non_arrays_and_malformed_entries() {
        assert!(reshape_directory(&json!({"not":"array"})).is_empty());
        // Entry missing `name` is skipped.
        let v = json!([{ "isDirectory": true }, { "name": "ok", "isDirectory": false }]);
        let entries = reshape_directory(&v);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "ok");
    }

    #[test]
    fn reshape_diff_whole_worktree_when_file_empty() {
        let v = json!({ "files": [
            { "path": "a", "hunks": [{ "patch": "PA" }] },
            { "path": "b", "hunks": [{ "patch": "PB" }] }
        ]});
        let (diff, found) = reshape_diff(&v, "");
        assert!(found);
        assert!(diff.contains("PA") && diff.contains("PB"));
    }

    #[test]
    fn reshape_diff_missing_files_key_is_empty_not_found() {
        let (diff, found) = reshape_diff(&json!({}), "a");
        assert!(diff.is_empty());
        assert!(!found);
    }

    #[test]
    fn reshape_branch_no_array_is_non_repo() {
        let (branch, ahead, behind, is_repo) = reshape_branch(&json!("x"));
        assert!(branch.is_none() && ahead == 0 && behind == 0 && !is_repo);
    }
}
