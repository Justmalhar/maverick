//! Claude Code hook bridge — Rust port of Swift `HookServer` + `HookConfigWriter`.
//!
//! ## What it does
//!
//! Claude Code, when configured with `{type:"http", url:"http://localhost:7789/
//! hook"}` hooks, POSTs a JSON body to us on every lifecycle event. This module:
//!
//! 1. Runs a tiny HTTP/1.1 server bound to **127.0.0.1 ONLY** on port 7789. No
//!    LAN exposure; the hook source is always the local Claude Code process.
//! 2. Normalizes each payload through the Claude adapter into [`AgentEvent`]s and
//!    publishes them on the shared bus, routed to our session UUID via the
//!    `claudeId → sessionUUID` index ([`crate::remote::agent_host::AgentHost`]).
//! 3. For `PermissionRequest` hooks, **holds the HTTP connection open ≤ 30 s**
//!    while it fans a `permission_request` `agent_event` to the client and awaits
//!    the client's `permission_response`. The client's decision becomes the hook
//!    HTTP reply (`{"hookSpecificOutput":{...,"decision":{"behavior":"allow|deny"}}}`).
//!    A 30 s timeout auto-denies — fail closed.
//!
//! [`HookConfigWriter`] idempotently merges the hook endpoints into
//! `~/.claude/settings.json` without clobbering the user's own hooks, and
//! refuses to touch a corrupt file.

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{broadcast, oneshot, Mutex};
use uuid::Uuid;

use crate::remote::adapters::{ClaudeCodeAdapter, Normalizer};
use crate::remote::agent_host::AgentHost;
use crate::remote::ServerMessage;

/// Loopback hook port. Matches Swift `HookServer` and the URL written by
/// [`HookConfigWriter`].
pub const HOOK_PORT: u16 = 7789;

/// Auto-deny a held PermissionRequest after this long with no client decision.
const PERMISSION_TIMEOUT: Duration = Duration::from_secs(30);

/// Max hook body we read (matches Swift's 64 KiB cap).
const MAX_BODY: usize = 64 * 1024;

/// Identifies an in-flight permission wait. Keying on `(session_id, request_id)`
/// — not `request_id` alone — is a security boundary: a paired remote may only
/// answer a prompt for the session it is attached to. Routing on `request_id`
/// alone would let any remote resolve ANOTHER session's pending permission.
type PendingKey = (Uuid, String);

/// Registry of in-flight permission waits: `(session_id, request_id) → oneshot
/// sender`. The HTTP handler parks on the receiver; [`HookBridge::resolve_permission`]
/// (driven by the client's WS `permission_response`) fires the sender — but only
/// when the response's `session_id` matches the session the prompt was raised for.
type PendingPermissions = Arc<Mutex<HashMap<PendingKey, oneshot::Sender<bool>>>>;

/// Result of parking on a held permission request.
#[derive(Debug, PartialEq, Eq)]
enum PermissionWait {
    /// The remote decided (or we auto-denied on timeout): `true` = allow.
    Decided(bool),
    /// A wait was already in flight for this `(session_id, request_id)` → reject
    /// the second hook with a `400` instead of clobbering the first.
    Duplicate,
}

/// Shared hook-bridge state: the event bus, the session index, and the pending
/// permission registry. Cloned into each accepted connection's task.
#[derive(Clone)]
pub struct HookBridge {
    bus: broadcast::Sender<(Uuid, ServerMessage)>,
    agent_host: Arc<AgentHost>,
    pending: PendingPermissions,
}

impl HookBridge {
    pub fn new(bus: broadcast::Sender<(Uuid, ServerMessage)>, agent_host: Arc<AgentHost>) -> Self {
        Self {
            bus,
            agent_host,
            pending: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Resolve a held PermissionRequest with the client's decision. No-op if the
    /// request already timed out, is unknown, OR belongs to a different session
    /// than `session_id` — a remote may only answer prompts for a session it is
    /// attached to. Called from the WS bridge when a `permission_response`
    /// arrives. `request_id` is canonicalized to match the form the wait was
    /// registered under.
    pub async fn resolve_permission(&self, session_id: Uuid, request_id: &str, allowed: bool) {
        let key = (session_id, canonicalize_request_id(request_id));
        if let Some(tx) = self.pending.lock().await.remove(&key) {
            let _ = tx.send(allowed);
        }
    }

    /// Bind the loopback hook listener and start accepting. Returns the bound
    /// address (port may differ from default if `port` is `Some(0)` for tests).
    pub async fn serve(self, port: u16) -> Result<HookListenerHandle, String> {
        let bind = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        let listener = TcpListener::bind(bind)
            .await
            .map_err(|e| format!("hook server failed to bind {bind}: {e}"))?;
        let addr = listener.local_addr().map_err(|e| e.to_string())?;

        let task = tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((stream, peer)) => {
                        // Defence in depth: only ever serve loopback.
                        if !peer.ip().is_loopback() {
                            continue;
                        }
                        let bridge = self.clone();
                        tokio::spawn(async move {
                            let _ = bridge.handle_connection(stream).await;
                        });
                    }
                    Err(e) => log::warn!("hook: accept error: {e}"),
                }
            }
        });
        Ok(HookListenerHandle { addr, task })
    }

    /// Test-only: drive `process_body` directly (the bridge integration test
    /// needs to hold a permission request without a live TCP socket).
    #[cfg(test)]
    pub async fn test_process_body(&self, body: &Value) -> String {
        self.process_body(body).await
    }

    /// Read one HTTP request, process its body, and write the response.
    async fn handle_connection(&self, mut stream: tokio::net::TcpStream) -> std::io::Result<()> {
        let raw = read_http_request(&mut stream).await?;
        let response = match parse_body(&raw) {
            Some(body) => self.process_body(&body).await,
            None => bad_request(),
        };
        stream.write_all(response.as_bytes()).await?;
        stream.flush().await
    }

    /// Normalize the hook body and produce the HTTP response. Blocks (≤30 s) for
    /// PermissionRequest; immediately `200 {}` otherwise.
    async fn process_body(&self, body: &Value) -> String {
        let session_string = body.get("session_id").and_then(Value::as_str).unwrap_or("").to_string();
        let hook_name = body.get("hook_event_name").and_then(Value::as_str).unwrap_or("");
        let is_permission = hook_name == "PermissionRequest";

        // Resolve the routed session UUID ONCE so the broadcast and the pending
        // permission wait agree on which session this hook belongs to.
        let session_id = self.resolve_session(&session_string);

        // The request_id we register the wait under MUST equal the string the
        // client will echo in `permission_response`. The protocol types that
        // field as a UUID, so the client round-trips it through `Uuid` →
        // `to_string()` (lowercase canonical). Normalize to that same canonical
        // form on both the broadcast event and the pending-wait key.
        let canonical_request_id = is_permission.then(|| {
            let raw = body
                .get("request_id")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| Uuid::new_v4().to_string());
            canonicalize_request_id(&raw)
        });

        // Normalize → events. The Claude adapter is the only one with hooks.
        let mut adapter = ClaudeCodeAdapter::new();
        let events = adapter.normalize_hook(body);
        for mut event in events {
            // Stamp the canonical request id on the permission event so the
            // client echoes back exactly what we keyed the wait under.
            if let (Some(canon), crate::remote::AgentEvent::PermissionRequest { permission_event }) =
                (&canonical_request_id, &mut event)
            {
                permission_event.request_id = canon.clone();
            }
            self.broadcast_event(session_id, event);
        }

        match (canonical_request_id, session_id) {
            // A held permission request keyed on (session, request_id): only the
            // attached session's remote can resolve it.
            (Some(request_id), Some(sid)) => match self.wait_for_permission(sid, &request_id).await {
                PermissionWait::Decided(allowed) => permission_response(allowed),
                PermissionWait::Duplicate => bad_request(),
            },
            // A permission request whose session we can't resolve has no remote
            // that may legitimately answer it → fail closed (deny) immediately.
            (Some(_), None) => {
                log::debug!("hook: permission for unknown session '{session_string}' — auto-denying");
                permission_response(false)
            }
            _ => ok_empty(),
        }
    }

    /// Resolve a hook `session_id` string to its routed session UUID via the
    /// claude-id index, falling back to a verbatim UUID. `None` if unknown.
    fn resolve_session(&self, session_string: &str) -> Option<Uuid> {
        self.agent_host
            .resolve_claude_id(session_string)
            .or_else(|| Uuid::parse_str(session_string).ok())
    }

    /// Publish a hook-derived event to its already-resolved session UUID on the
    /// bus. Drops the event if the session id is unknown (mirrors Swift's
    /// `receiveHook` invalid-UUID drop).
    fn broadcast_event(&self, session_id: Option<Uuid>, event: crate::remote::AgentEvent) {
        if let Some(sid) = session_id {
            let _ = self.bus.send((sid, ServerMessage::AgentEvent { session_id: sid, event }));
        } else {
            log::debug!("hook: dropping event — unknown session");
        }
    }

    /// Park until the attached session's remote decides or 30 s elapses (then
    /// auto-deny). The wait is keyed on `(session_id, request_id)`. A duplicate
    /// `request_id` already in flight for the same session is rejected with
    /// [`PermissionWait::Duplicate`] (→ HTTP 400) rather than silently replacing
    /// (and leaking) the first wait's sender — the first request stays parked
    /// until its own timeout/decision.
    async fn wait_for_permission(&self, session_id: Uuid, request_id: &str) -> PermissionWait {
        let key = (session_id, request_id.to_string());
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending.lock().await;
            if pending.contains_key(&key) {
                log::warn!("hook: duplicate permission request_id {request_id} — rejecting");
                return PermissionWait::Duplicate;
            }
            pending.insert(key.clone(), tx);
        }

        match tokio::time::timeout(PERMISSION_TIMEOUT, rx).await {
            Ok(Ok(allowed)) => PermissionWait::Decided(allowed),
            // Timeout or sender dropped → fail closed (deny). Clean up the entry.
            _ => {
                self.pending.lock().await.remove(&key);
                log::info!("hook: permission {request_id} timed out — auto-denying");
                PermissionWait::Decided(false)
            }
        }
    }
}

/// Handle to a running hook listener: its bound address + the accept task.
pub struct HookListenerHandle {
    pub addr: SocketAddr,
    task: tokio::task::JoinHandle<()>,
}

impl HookListenerHandle {
    /// Stop accepting new connections.
    pub fn shutdown(self) {
        self.task.abort();
    }
}

// ---- HTTP helpers (hand-rolled HTTP/1.1, no extra dependency) -------------

/// Read an HTTP request: headers, then body up to `Content-Length` (capped at
/// `MAX_BODY`). Loops `read` until the full body is in hand, mirroring the Swift
/// `receiveRemainingBody` recursion.
async fn read_http_request(stream: &mut tokio::net::TcpStream) -> std::io::Result<Vec<u8>> {
    let mut buf = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];

    // Read until we have the header terminator.
    let header_end = loop {
        if let Some(pos) = find_subslice(&buf, b"\r\n\r\n") {
            break pos + 4;
        }
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            // EOF before headers complete.
            return Ok(buf);
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.len() > MAX_BODY {
            return Ok(buf);
        }
    };

    let content_length = parse_content_length(&buf[..header_end]).min(MAX_BODY);
    let needed = header_end + content_length;
    while buf.len() < needed {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.len() > MAX_BODY + header_end {
            break;
        }
    }
    Ok(buf)
}

/// Extract and JSON-parse the body of a raw HTTP request. `None` if there's no
/// `\r\n\r\n` separator or the body isn't a JSON object.
fn parse_body(raw: &[u8]) -> Option<Value> {
    let sep = find_subslice(raw, b"\r\n\r\n")?;
    let body = &raw[sep + 4..];
    if body.is_empty() {
        return None;
    }
    match serde_json::from_slice::<Value>(body) {
        Ok(v @ Value::Object(_)) => Some(v),
        _ => None,
    }
}

/// Parse the `Content-Length` header (case-insensitive) from header bytes.
fn parse_content_length(headers: &[u8]) -> usize {
    let text = String::from_utf8_lossy(headers);
    for line in text.split("\r\n") {
        let lower = line.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("content-length:") {
            return rest.trim().parse().unwrap_or(0);
        }
    }
    0
}

/// Canonicalize a permission `request_id` to the form the client round-trips it
/// through: if it parses as a UUID, use the lowercase hyphenated `to_string()`;
/// otherwise leave it verbatim (still works as long as both sides agree).
fn canonicalize_request_id(raw: &str) -> String {
    Uuid::parse_str(raw).map(|u| u.to_string()).unwrap_or_else(|_| raw.to_string())
}

/// Find the first index of `needle` in `haystack`.
fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn http_response(status: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    )
}

fn ok_empty() -> String {
    http_response("200 OK", "{}")
}

fn bad_request() -> String {
    "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n".to_string()
}

fn permission_response(allowed: bool) -> String {
    let behavior = if allowed { "allow" } else { "deny" };
    let body = format!(
        "{{\"hookSpecificOutput\":{{\"hookEventName\":\"PermissionRequest\",\"decision\":{{\"behavior\":\"{behavior}\"}}}}}}"
    );
    http_response("200 OK", &body)
}

// ---- HookConfigWriter -----------------------------------------------------

/// Idempotently merges Maverick's HTTP hook endpoints into `~/.claude/settings.
/// json`. Rust port of Swift `HookConfigWriter`.
///
/// Invariants:
/// - **Never clobbers** the user's existing hooks: our entry is appended to each
///   event's hook list only if our URL isn't already present.
/// - **Refuses a corrupt file**: if `settings.json` exists but isn't a JSON
///   object, `install` returns `Err` and writes nothing (fail safe, don't
///   destroy the user's config).
/// - Creates the file (and `~/.claude/`) when absent.
/// - Writes atomically (temp file + rename) so a crash mid-write can't leave a
///   half-written settings file.
pub struct HookConfigWriter;

/// The hook URL Maverick registers. Loopback only — same host as [`HookBridge`].
pub const HOOK_URL: &str = "http://localhost:7789/hook";

/// Every Claude Code hook event Maverick handles, with its per-event timeout (s).
const MAVERICK_HOOKS: &[(&str, u64)] = &[
    ("PreToolUse", 10),
    ("PostToolUse", 10),
    ("PostToolUseFailure", 10),
    ("PostToolBatch", 10),
    ("PermissionRequest", 30),
    ("PermissionDenied", 10),
    ("Stop", 10),
    ("SubagentStart", 10),
    ("SubagentStop", 10),
    ("SessionStart", 10),
    ("Notification", 10),
    ("TaskCreated", 10),
    ("TaskCompleted", 10),
];

impl HookConfigWriter {
    /// Merge Maverick's hooks into the default `~/.claude/settings.json`.
    pub fn install() -> Result<(), String> {
        let path = dirs::home_dir()
            .ok_or("no home directory")?
            .join(".claude")
            .join("settings.json");
        Self::install_at(&path)
    }

    /// Merge into an explicit path (used by tests with a temp file).
    pub fn install_at(path: &std::path::Path) -> Result<(), String> {
        let mut settings = if path.exists() {
            let data = std::fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
            match serde_json::from_slice::<Value>(&data) {
                Ok(Value::Object(map)) => map,
                // Corrupt / non-object: refuse to overwrite.
                _ => return Err(format!("{} is not a valid JSON object — refusing to overwrite", path.display())),
            }
        } else {
            serde_json::Map::new()
        };

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }

        let mut hooks = match settings.get("hooks") {
            Some(Value::Object(m)) => m.clone(),
            _ => serde_json::Map::new(),
        };
        for (event, timeout) in MAVERICK_HOOKS {
            let merged = merge_hook_list(hooks.get(*event), *timeout);
            hooks.insert((*event).to_string(), Value::Array(merged));
        }
        settings.insert("hooks".to_string(), Value::Object(hooks));

        let output = serde_json::to_vec_pretty(&Value::Object(settings))
            .map_err(|e| format!("serialize settings: {e}"))?;
        atomic_write(path, &output)
    }
}

/// Return the merged hook list for one event, ensuring our endpoint is present
/// exactly once. Preserves every existing entry verbatim.
fn merge_hook_list(existing: Option<&Value>, timeout: u64) -> Vec<Value> {
    let mut list: Vec<Value> = existing
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let already = list.iter().any(|entry| {
        entry
            .get("hooks")
            .and_then(Value::as_array)
            .map(|inner| {
                inner.iter().any(|h| h.get("url").and_then(Value::as_str) == Some(HOOK_URL))
            })
            .unwrap_or(false)
    });

    if !already {
        list.push(serde_json::json!({
            "hooks": [ { "type": "http", "url": HOOK_URL, "timeout": timeout } ]
        }));
    }
    list
}

/// Write `bytes` to `path` atomically: write a sibling temp file, then rename
/// over the target so readers never see a half-written file.
fn atomic_write(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or("path has no parent")?;
    let tmp = dir.join(format!(
        ".{}.tmp-{}",
        path.file_name().and_then(|s| s.to_str()).unwrap_or("settings.json"),
        Uuid::new_v4()
    ));
    std::fs::write(&tmp, bytes).map_err(|e| format!("write temp: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("rename temp → {}: {e}", path.display())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote::agent_host::{AgentHost, AgentSpawner, SpawnedAgent};
    use crate::remote::{AgentEvent, AgentProvider};
    use async_trait::async_trait;
    use serde_json::json;

    struct NoSpawn;
    #[async_trait]
    impl AgentSpawner for NoSpawn {
        async fn spawn(
            &self,
            _p: AgentProvider,
            _c: Option<&str>,
            _r: Option<&str>,
        ) -> Result<SpawnedAgent, String> {
            Err("no spawn in hook test".into())
        }
    }

    fn bridge() -> (HookBridge, Arc<AgentHost>, broadcast::Receiver<(Uuid, ServerMessage)>) {
        let (tx, rx) = broadcast::channel(64);
        let host = Arc::new(AgentHost::new(Arc::new(NoSpawn), tx.clone()));
        (HookBridge::new(tx, host.clone()), host, rx)
    }

    async fn recv(rx: &mut broadcast::Receiver<(Uuid, ServerMessage)>) -> (Uuid, ServerMessage) {
        tokio::time::timeout(Duration::from_secs(2), rx.recv())
            .await
            .expect("event")
            .expect("bus open")
    }

    // ---- HTTP parsing units ----

    #[test]
    fn parse_content_length_case_insensitive() {
        let h = b"POST /hook HTTP/1.1\r\nContent-Length: 17\r\n\r\n";
        assert_eq!(parse_content_length(h), 17);
        let h2 = b"POST / HTTP/1.1\r\ncontent-length:5\r\n\r\n";
        assert_eq!(parse_content_length(h2), 5);
        assert_eq!(parse_content_length(b"GET / HTTP/1.1\r\n\r\n"), 0);
    }

    #[test]
    fn parse_body_extracts_json_object() {
        let raw = b"POST /hook HTTP/1.1\r\nContent-Length: 9\r\n\r\n{\"a\":1.0}";
        assert_eq!(parse_body(raw), Some(json!({ "a": 1.0 })));
        assert!(parse_body(b"no headers").is_none());
        // body is JSON but not an object → rejected
        assert!(parse_body(b"H\r\n\r\n[1,2]").is_none());
    }

    #[test]
    fn permission_response_shape() {
        let allow = permission_response(true);
        assert!(allow.contains("\"behavior\":\"allow\""));
        assert!(allow.contains("200 OK"));
        let deny = permission_response(false);
        assert!(deny.contains("\"behavior\":\"deny\""));
    }

    // ---- non-permission hook → immediate 200, routed event ----

    #[tokio::test]
    async fn non_permission_hook_acks_and_routes_event() {
        let (b, host, mut rx) = bridge();
        let sid = Uuid::new_v4();
        // Register the claude id so routing resolves.
        host.test_register_claude_id("claude-1", sid);

        let body = json!({
            "session_id": "claude-1",
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "tool_use_id": "tc1",
            "tool_input": { "command": "ls" }
        });
        let resp = b.process_body(&body).await;
        assert!(resp.contains("200 OK"));
        assert!(resp.contains("{}"));

        let (got_sid, msg) = recv(&mut rx).await;
        assert_eq!(got_sid, sid);
        assert!(matches!(
            msg,
            ServerMessage::AgentEvent { event: AgentEvent::ToolCallStart { .. }, .. }
        ));
    }

    #[tokio::test]
    async fn hook_with_unknown_session_drops_event() {
        let (b, _host, mut rx) = bridge();
        let body = json!({
            "session_id": "not-registered-and-not-a-uuid",
            "hook_event_name": "Stop"
        });
        let resp = b.process_body(&body).await;
        assert!(resp.contains("200 OK"));
        // No event reaches the bus.
        let got = tokio::time::timeout(Duration::from_millis(200), rx.recv()).await;
        assert!(got.is_err(), "event dropped for unknown session");
    }

    #[tokio::test]
    async fn hook_session_id_as_raw_uuid_routes() {
        let (b, _host, mut rx) = bridge();
        let sid = Uuid::new_v4();
        let body = json!({
            "session_id": sid.to_string(),
            "hook_event_name": "Stop"
        });
        let resp = b.process_body(&body).await;
        assert!(resp.contains("200 OK"));
        let (got, _msg) = recv(&mut rx).await;
        assert_eq!(got, sid, "raw-UUID session id routes directly");
    }

    // ---- blocking permission round-trips ----

    #[tokio::test]
    async fn permission_request_blocks_until_client_responds_allow() {
        let (b, host, mut rx) = bridge();
        let sid = Uuid::new_v4();
        host.test_register_claude_id("c", sid);
        let bridge_clone = b.clone();

        let body = json!({
            "session_id": "c",
            "hook_event_name": "PermissionRequest",
            "request_id": "req-1",
            "tool_name": "Bash",
            "tool_input": { "command": "rm x" }
        });

        // process_body parks until we resolve; run it concurrently.
        let handle = tokio::spawn(async move { bridge_clone.process_body(&body).await });

        // Client first sees the permission_request event...
        let (_sid, msg) = recv(&mut rx).await;
        assert!(matches!(
            msg,
            ServerMessage::AgentEvent { event: AgentEvent::PermissionRequest { .. }, .. }
        ));

        // ...then sends its decision, which becomes the HTTP reply.
        // Small yield so the wait registers before we resolve.
        tokio::time::sleep(Duration::from_millis(20)).await;
        b.resolve_permission(sid, "req-1", true).await;

        let resp = handle.await.unwrap();
        assert!(resp.contains("\"behavior\":\"allow\""));
    }

    #[tokio::test]
    async fn permission_request_deny_round_trip() {
        let (b, host, _rx) = bridge();
        let sid = Uuid::new_v4();
        host.test_register_claude_id("c", sid);
        let bridge_clone = b.clone();
        let body = json!({
            "session_id": "c", "hook_event_name": "PermissionRequest", "request_id": "req-2", "tool_name": "Bash"
        });
        let handle = tokio::spawn(async move { bridge_clone.process_body(&body).await });
        tokio::time::sleep(Duration::from_millis(20)).await;
        b.resolve_permission(sid, "req-2", false).await;
        let resp = handle.await.unwrap();
        assert!(resp.contains("\"behavior\":\"deny\""));
    }

    #[tokio::test(start_paused = true)]
    async fn permission_request_times_out_to_deny() {
        let (b, host, _rx) = bridge();
        let sid = Uuid::new_v4();
        host.test_register_claude_id("c", sid);
        let bridge_clone = b.clone();
        let body = json!({
            "session_id": "c", "hook_event_name": "PermissionRequest", "request_id": "req-3", "tool_name": "Bash"
        });
        let handle = tokio::spawn(async move { bridge_clone.process_body(&body).await });
        // No client response; advance virtual time past the 30 s timeout.
        tokio::time::advance(PERMISSION_TIMEOUT + Duration::from_secs(1)).await;
        let resp = handle.await.unwrap();
        assert!(resp.contains("\"behavior\":\"deny\""), "auto-denied on timeout");
    }

    #[tokio::test]
    async fn resolve_unknown_request_is_noop() {
        let (b, _host, _rx) = bridge();
        // Should not panic / hang.
        b.resolve_permission(Uuid::new_v4(), "never-registered", true).await;
    }

    // ---- Finding 2: a permission_response from the WRONG session is ignored ----

    #[tokio::test]
    async fn permission_response_from_wrong_session_is_rejected() {
        let (b, host, _rx) = bridge();
        // Two distinct sessions, each with a routable claude id.
        let attacker = Uuid::new_v4();
        let victim = Uuid::new_v4();
        host.test_register_claude_id("victim", victim);
        host.test_register_claude_id("attacker", attacker);

        // The victim session raises a permission prompt and parks.
        let bridge_clone = b.clone();
        let body = json!({
            "session_id": "victim",
            "hook_event_name": "PermissionRequest",
            "request_id": "shared-req",
            "tool_name": "Bash"
        });
        let held = tokio::spawn(async move { bridge_clone.process_body(&body).await });
        tokio::time::sleep(Duration::from_millis(20)).await;

        // The attacker's remote tries to answer the victim's prompt by request_id.
        // It MUST NOT resolve — the key includes the session id.
        b.resolve_permission(attacker, "shared-req", true).await;
        // Give the (incorrectly-routed) resolve a chance to land, then confirm the
        // held request is still parked.
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!held.is_finished(), "wrong-session resolve must not unblock the wait");

        // The rightful (victim) session resolves it.
        b.resolve_permission(victim, "shared-req", false).await;
        let resp = held.await.unwrap();
        assert!(resp.contains("\"behavior\":\"deny\""), "only the owning session resolves");
    }

    #[tokio::test]
    async fn permission_for_unknown_session_auto_denies() {
        let (b, _host, _rx) = bridge();
        // No claude id registered and not a UUID → session unresolvable → fail
        // closed immediately (no parking, no remote can answer it).
        let body = json!({
            "session_id": "ghost-session",
            "hook_event_name": "PermissionRequest",
            "request_id": "req-x",
            "tool_name": "Bash"
        });
        let resp = b.process_body(&body).await;
        assert!(resp.contains("\"behavior\":\"deny\""));
    }

    // ---- Finding 5: a duplicate request_id is rejected, not silently replaced ----

    #[tokio::test]
    async fn duplicate_request_id_is_rejected_and_first_wait_survives() {
        let (b, host, _rx) = bridge();
        let sid = Uuid::new_v4();
        host.test_register_claude_id("c", sid);

        // First request parks.
        let b1 = b.clone();
        let body1 = json!({
            "session_id": "c", "hook_event_name": "PermissionRequest",
            "request_id": "dupe", "tool_name": "Bash"
        });
        let first = tokio::spawn(async move { b1.process_body(&body1).await });
        tokio::time::sleep(Duration::from_millis(20)).await;

        // Second request with the SAME (session, request_id) is rejected with 400.
        let body2 = json!({
            "session_id": "c", "hook_event_name": "PermissionRequest",
            "request_id": "dupe", "tool_name": "Bash"
        });
        let resp2 = b.process_body(&body2).await;
        assert!(resp2.contains("400 Bad Request"), "duplicate rejected: {resp2}");

        // The FIRST wait must still be live (not clobbered) and resolvable.
        assert!(!first.is_finished(), "first wait leaked / was replaced");
        b.resolve_permission(sid, "dupe", true).await;
        let resp1 = first.await.unwrap();
        assert!(resp1.contains("\"behavior\":\"allow\""), "first request still resolves");
    }

    // ---- live listener binds loopback only ----

    #[tokio::test]
    async fn serve_binds_loopback_and_acks_a_real_post() {
        let (b, host, _rx) = bridge();
        let sid = Uuid::new_v4();
        host.test_register_claude_id("c", sid);
        // Bind an ephemeral port (0) to avoid colliding with a real 7789.
        let handle = b.serve(0).await.expect("bind");
        assert!(handle.addr.ip().is_loopback(), "bound to loopback only");
        let port = handle.addr.port();

        // Send a raw HTTP POST for a non-permission hook.
        let body = "{\"session_id\":\"c\",\"hook_event_name\":\"Stop\"}";
        let req = format!(
            "POST /hook HTTP/1.1\r\nHost: localhost\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        let mut conn = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        conn.write_all(req.as_bytes()).await.unwrap();
        let mut resp = Vec::new();
        // Read until the server closes / we have the response.
        let mut chunk = [0u8; 1024];
        loop {
            let n = tokio::time::timeout(Duration::from_secs(2), conn.read(&mut chunk))
                .await
                .expect("read within timeout")
                .unwrap();
            if n == 0 {
                break;
            }
            resp.extend_from_slice(&chunk[..n]);
            if find_subslice(&resp, b"\r\n\r\n").is_some() {
                break;
            }
        }
        let text = String::from_utf8_lossy(&resp);
        assert!(text.contains("200 OK"), "got: {text}");
        handle.shutdown();
    }

    // ---- HookConfigWriter ----

    fn read_settings(path: &std::path::Path) -> Value {
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
    }

    #[test]
    fn config_writer_creates_file_with_all_events() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".claude").join("settings.json");
        HookConfigWriter::install_at(&path).unwrap();

        let settings = read_settings(&path);
        let hooks = settings.get("hooks").and_then(Value::as_object).unwrap();
        // Every Maverick event is present.
        for (event, _) in MAVERICK_HOOKS {
            let list = hooks.get(*event).and_then(Value::as_array).unwrap();
            let has_ours = list.iter().any(|e| {
                e.get("hooks")
                    .and_then(Value::as_array)
                    .unwrap()
                    .iter()
                    .any(|h| h.get("url").and_then(Value::as_str) == Some(HOOK_URL))
            });
            assert!(has_ours, "event {event} missing our hook");
        }
        // PermissionRequest carries the 30 s timeout.
        let perm = hooks.get("PermissionRequest").and_then(Value::as_array).unwrap();
        let timeout = perm[0]["hooks"][0]["timeout"].as_u64().unwrap();
        assert_eq!(timeout, 30);
    }

    #[test]
    fn config_writer_preserves_existing_user_hooks_and_other_keys() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let existing = json!({
            "model": "opus",
            "hooks": {
                "PreToolUse": [
                    { "hooks": [ { "type": "command", "command": "echo user-hook" } ] }
                ],
                "CustomEvent": [
                    { "hooks": [ { "type": "command", "command": "keep me" } ] }
                ]
            }
        });
        std::fs::write(&path, serde_json::to_vec_pretty(&existing).unwrap()).unwrap();

        HookConfigWriter::install_at(&path).unwrap();
        let settings = read_settings(&path);

        // Unrelated top-level key preserved.
        assert_eq!(settings["model"], json!("opus"));
        // The user's own PreToolUse command hook is still there, and ours added.
        let pre = settings["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(pre.iter().any(|e| e["hooks"][0]["command"] == json!("echo user-hook")));
        assert!(pre.iter().any(|e| e["hooks"][0]["url"] == json!(HOOK_URL)));
        // A user event we don't manage is untouched.
        assert_eq!(settings["hooks"]["CustomEvent"][0]["hooks"][0]["command"], json!("keep me"));
    }

    #[test]
    fn config_writer_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        HookConfigWriter::install_at(&path).unwrap();
        HookConfigWriter::install_at(&path).unwrap();
        HookConfigWriter::install_at(&path).unwrap();

        let settings = read_settings(&path);
        // Re-running must NOT duplicate our entry.
        let pre = settings["hooks"]["PreToolUse"].as_array().unwrap();
        let ours = pre
            .iter()
            .filter(|e| e["hooks"][0]["url"] == json!(HOOK_URL))
            .count();
        assert_eq!(ours, 1, "exactly one Maverick hook after repeated installs");
    }

    #[test]
    fn config_writer_refuses_corrupt_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, b"{ this is not valid json").unwrap();

        let err = HookConfigWriter::install_at(&path).unwrap_err();
        assert!(err.contains("refusing to overwrite"));
        // The corrupt file is left exactly as it was — not clobbered.
        assert_eq!(std::fs::read(&path).unwrap(), b"{ this is not valid json");
    }

    #[test]
    fn config_writer_refuses_non_object_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, b"[1, 2, 3]").unwrap();
        assert!(HookConfigWriter::install_at(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"[1, 2, 3]");
    }
}
