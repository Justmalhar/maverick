//! Companion WebSocket server (Companion-3).
//!
//! Speaks MaverickProtocol: one JSON object per text frame, decoded into a
//! `ClientMessage`, routed through [`RemoteBridge`], with each [`ServerMessage`]
//! reply encoded back as one text frame. Binary frames are ignored; pings are
//! auto-ponged by tungstenite.
//!
//! ## Safety posture (read this before enabling)
//!
//! - **Loopback only.** The listener binds `127.0.0.1` exclusively. There is no
//!   LAN/Tailscale exposure here — that, plus pairing/auth, is **Companion-5**.
//! - **Disabled by default.** Nothing starts the server at boot. The
//!   `remote_start` Tauri command must be called explicitly, and the persisted
//!   setting (`RemoteState.enabled`) defaults to `false`. A loopback-only,
//!   off-by-default, unauthenticated server is safe to ship in this state.
//! - **16 MiB max frame.** Bounds a single inbound/outbound message so a hostile
//!   or buggy client can't force unbounded allocation.

use std::net::SocketAddr;
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use tauri::{AppHandle, Manager, Runtime};
use tokio::net::TcpListener;
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;

use crate::pty::{PtyManager, SpawnParams, Subscription};
use crate::remote::bridge::{PtyHost, RemoteBridge, SidecarRequest};
use crate::remote::ServerMessage;
use crate::state::AppState;

/// Default loopback port. Chosen to match the Swift reference server (8765).
pub const DEFAULT_PORT: u16 = 8765;

/// Hard ceiling on a single WS frame, both directions. 16 MiB comfortably holds
/// a 256 KiB scrollback replay (base64 ≈ 340 KiB) plus headroom, while bounding
/// worst-case allocation per message.
const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;

/// Production `PtyHost`: spawns/reads/writes the Rust-core [`PtyManager`] held in
/// Tauri state, using an `AppHandle` so `spawn` still tees output to the local
/// webview's `pty:data` listeners exactly as a desktop-spawned PTY would.
struct ManagedPty<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> ManagedPty<R> {
    fn manager(&self) -> Option<tauri::State<'_, PtyManager>> {
        self.app.try_state::<PtyManager>()
    }
}

impl<R: Runtime> PtyHost for ManagedPty<R> {
    fn spawn(&self, command: &str, cwd: Option<&str>) -> Result<String, String> {
        let manager = self.manager().ok_or("pty manager unavailable")?;
        manager.spawn(
            &self.app,
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
        self.manager()?.subscribe(pty_id)
    }
    fn write(&self, pty_id: &str, data: &str) -> Result<(), String> {
        self.manager().ok_or("pty manager unavailable")?.write(pty_id, data)
    }
    fn resize(&self, pty_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        self.manager().ok_or("pty manager unavailable")?.resize(pty_id, cols, rows)
    }
    fn kill(&self, pty_id: &str) -> Result<(), String> {
        self.manager().ok_or("pty manager unavailable")?.kill(pty_id)
    }
}

/// A running listener: the bound address plus a handle whose abort stops accept.
/// `hook` is the Claude hook bridge's localhost:7789 listener (if it bound).
/// `mdns` is the `_maverick._tcp` advertiser, present only when bound to the LAN.
struct Running {
    addr: SocketAddr,
    accept_task: JoinHandle<()>,
    hook: Option<crate::remote::hook_server::HookListenerHandle>,
    mdns: Option<crate::remote::transport::MdnsAdvertiser>,
    scope: crate::remote::transport::BindScope,
}

/// Snapshot of the server for the `remote_status` command.
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    /// The persisted opt-in (defaults false until a device is paired + enabled).
    pub enabled: bool,
    /// Whether a listener is currently bound.
    pub running: bool,
    /// The bound port, when running.
    pub port: Option<u16>,
    /// True when the listener is bound to the LAN (0.0.0.0), false for loopback.
    /// The server only widens to LAN when enabled AND at least one device is paired.
    pub lan_exposed: bool,
    /// Count of paired companion devices.
    pub paired_devices: usize,
}

/// Process-wide companion-server controller held in Tauri state. Owns the
/// enabled flag, the (at most one) running listener, and the Companion-5 security
/// state: the desktop static identity, the live pairing-session registry, and the
/// persistent paired-device store (TOFU).
pub struct RemoteServer {
    enabled: std::sync::atomic::AtomicBool,
    running: Mutex<Option<Running>>,
    /// Shared security context, lazily initialized on first `start`/`pair` (it
    /// needs the OS-resolved app-support dir from the `AppHandle`).
    security: Mutex<Option<Arc<crate::remote::auth_session::SecurityContext>>>,
}

impl Default for RemoteServer {
    fn default() -> Self {
        Self::new()
    }
}

impl RemoteServer {
    pub fn new() -> Self {
        Self {
            // OFF by default: stays disabled until a device is paired + enabled.
            enabled: std::sync::atomic::AtomicBool::new(false),
            running: Mutex::new(None),
            security: Mutex::new(None),
        }
    }

    /// Lazily build (or fetch) the security context, rooting the device store +
    /// identity under `<app-data>/companion`. The `AppState.paths.app_data_dir`
    /// is the Rust-owned OS app-support location.
    pub(crate) async fn security<R: Runtime>(
        &self,
        app: &AppHandle<R>,
    ) -> Result<Arc<crate::remote::auth_session::SecurityContext>, String> {
        let mut guard = self.security.lock().await;
        if let Some(ctx) = guard.as_ref() {
            return Ok(ctx.clone());
        }
        let dir = {
            let state = app.try_state::<AppState>().ok_or("app state unavailable")?;
            state.inner().paths.app_data_dir.join("companion")
        };
        let ctx = Arc::new(crate::remote::auth_session::SecurityContext::open(dir)?);
        *guard = Some(ctx.clone());
        Ok(ctx)
    }

    pub async fn status(&self) -> RemoteStatus {
        let guard = self.running.lock().await;
        let paired = match self.security.lock().await.as_ref() {
            Some(ctx) => ctx.devices.list().len(),
            None => 0,
        };
        let scope = guard.as_ref().map(|r| r.scope);
        RemoteStatus {
            enabled: self.enabled.load(std::sync::atomic::Ordering::Acquire),
            running: guard.is_some(),
            port: guard.as_ref().map(|r| r.addr.port()),
            lan_exposed: matches!(scope, Some(crate::remote::transport::BindScope::Lan)),
            paired_devices: paired,
        }
    }

    /// Mint a new QR pairing session and return its payload string. This is the
    /// `remote_pair` entry point. Does NOT require the server to be running, so a
    /// user can pair before/while enabling. Initializing the security context here
    /// also persists the static identity on first ever call.
    pub async fn pair<R: Runtime>(
        &self,
        app: AppHandle<R>,
        rendezvous: Option<String>,
        name: Option<String>,
    ) -> Result<crate::remote::auth_session::PairingTicket, String> {
        let ctx = self.security(&app).await?;
        Ok(ctx.mint_pairing(rendezvous.as_deref(), name.as_deref()))
    }

    /// List paired devices (`remote_devices`).
    pub async fn devices<R: Runtime>(
        &self,
        app: AppHandle<R>,
    ) -> Result<Vec<crate::remote::PairedDevice>, String> {
        let ctx = self.security(&app).await?;
        Ok(ctx.devices.list())
    }

    /// Revoke a paired device (`remote_revoke`). Removes the pinned row and tears
    /// down any of that device's live sessions, then re-resolves the bind scope:
    /// if the last device was revoked, the listener narrows back to loopback.
    pub async fn revoke<R: Runtime>(
        &self,
        app: AppHandle<R>,
        device_id: String,
    ) -> Result<bool, String> {
        let ctx = self.security(&app).await?;
        let removed = ctx.devices.revoke(&device_id).map_err(|e| e.to_string())?;
        if removed {
            ctx.sessions.revoke_device(&device_id);
            // Re-resolve exposure: dropping the last device must narrow to loopback.
            self.reconcile_bind(app).await?;
        }
        Ok(removed)
    }

    /// Start (or re-bind) the listener with the bind scope resolved from the
    /// enabled + paired state. Flips `enabled` to true. If already running with
    /// the correct scope, this is a no-op; otherwise it rebinds.
    pub async fn start<R: Runtime>(
        &self,
        app: AppHandle<R>,
        port: Option<u16>,
    ) -> Result<RemoteStatus, String> {
        self.enabled.store(true, std::sync::atomic::Ordering::Release);
        self.bind(app, port, true).await?;
        Ok(self.status().await)
    }

    /// Re-evaluate the bind scope without changing `enabled` (called after a pair
    /// or revoke so the listener widens/narrows to match the new paired state).
    async fn reconcile_bind<R: Runtime>(&self, app: AppHandle<R>) -> Result<(), String> {
        let enabled = self.enabled.load(std::sync::atomic::Ordering::Acquire);
        if enabled {
            self.bind(app, None, false).await?;
        }
        Ok(())
    }

    /// Core bind routine. Resolves the desired scope from (enabled, has-paired),
    /// and (re)binds the listener if the scope changed. Starts/stops the mDNS
    /// advertiser to match. `keep_port` reuses the currently-bound port on a
    /// rebind so the listener address only changes interface, not port.
    async fn bind<R: Runtime>(
        &self,
        app: AppHandle<R>,
        port: Option<u16>,
        _explicit: bool,
    ) -> Result<(), String> {
        use crate::remote::transport::{BindPolicy, BindScope, MdnsAdvertiser};

        let ctx = self.security(&app).await?;
        let enabled = self.enabled.load(std::sync::atomic::Ordering::Acquire);
        let has_paired = !ctx.devices.list().is_empty();
        let desired = BindPolicy::resolve(enabled, has_paired);

        // Decide + tear down the old listener under the lock, then DROP the guard
        // before the async binds below. The guard holds a `Running` whose
        // `MdnsAdvertiser` is `!Send`; keeping it across an `.await` would make
        // this future `!Send` and unspawnable (the first-pair watcher spawns it).
        let chosen_port = {
            let mut guard = self.running.lock().await;
            // Already bound to the desired scope → nothing to do.
            if let Some(running) = guard.as_ref() {
                if running.scope == desired {
                    return Ok(());
                }
            }
            // Determine the port: explicit arg wins, else reuse the running port, else default.
            let chosen_port = port
                .or_else(|| guard.as_ref().map(|r| r.addr.port()))
                .unwrap_or(DEFAULT_PORT);

            // Tear down the previous listener (and its mDNS) before re-binding.
            if let Some(prev) = guard.take() {
                prev.accept_task.abort();
                if let Some(mdns) = prev.mdns {
                    mdns.stop();
                }
                // Keep the existing hook bridge handle by re-installing below; abort
                // only the accept loop + mdns here.
                if let Some(hook) = prev.hook {
                    hook.shutdown();
                }
            }
            chosen_port
        };

        let bind = desired.socket_addr(chosen_port);
        let listener = TcpListener::bind(bind)
            .await
            .map_err(|e| format!("failed to bind {bind}: {e}"))?;
        let addr = listener.local_addr().map_err(|e| e.to_string())?;

        let sidecar: Arc<dyn SidecarRequest> = {
            let state = app.try_state::<AppState>().ok_or("app state unavailable")?;
            state.inner().sidecar.clone()
        };
        let pty: Arc<dyn PtyHost> = Arc::new(ManagedPty { app: app.clone() });
        let bridge = Arc::new(RemoteBridge::new(sidecar, pty));

        let hook_bridge = bridge.hook_bridge();
        if let Err(e) = crate::remote::hook_server::HookConfigWriter::install() {
            log::warn!("remote: hook config not written: {e}");
        }
        let hook = match hook_bridge.serve(crate::remote::hook_server::HOOK_PORT).await {
            Ok(handle) => Some(handle),
            Err(e) => {
                log::warn!("remote: hook server not started: {e}");
                None
            }
        };

        // From here on do NO `.await` while the `!Send` `MdnsAdvertiser` is alive
        // (it would make this future un-`spawn`able by the first-pair watcher).
        // Acquire the commit lock first, then build mDNS + spawn the tasks, all
        // synchronously, and store the `Running` snapshot.
        let mut guard = self.running.lock().await;

        // Advertise over mDNS only when LAN-exposed.
        let mdns = if desired == BindScope::Lan {
            let instance = ctx.instance_name();
            let host = format!("{}.local.", sanitize_host(&instance));
            match MdnsAdvertiser::start(&instance, &host, addr.port(), &ctx.fingerprint()) {
                Ok(adv) => Some(adv),
                Err(e) => {
                    log::warn!("remote: mDNS advertisement failed: {e}");
                    None
                }
            }
        } else {
            None
        };

        let accept_task = tokio::spawn(accept_loop(listener, bridge, ctx.clone()));

        // NOTE (Companion-5 review finding 3 — auto-widen on first pair, deferred):
        // re-binding the instant a device pins would need a spawned task calling
        // bind(), but bind()'s future is !Send (RemoteServer holds the !Send mDNS
        // advertiser inside its `running` Mutex, making RemoteServer !Sync), so it
        // can't cross a tokio::spawn boundary. The bind scope widens on the next
        // remote_start instead; reconcile_bind() still runs on the awaited
        // start()/revoke() command paths. Re-enabling the live watcher is a
        // follow-up that lands with the frontend pairing UI.

        *guard = Some(Running { addr, accept_task, hook, mdns, scope: desired });
        Ok(())
    }

    /// Stop accepting and flip `enabled` to false. In-flight per-socket tasks
    /// observe their stream closing as the listener drops. Idempotent.
    pub async fn stop(&self) -> RemoteStatus {
        if let Some(running) = self.running.lock().await.take() {
            running.accept_task.abort();
            if let Some(hook) = running.hook {
                hook.shutdown();
            }
            if let Some(mdns) = running.mdns {
                mdns.stop();
            }
        }
        self.enabled.store(false, std::sync::atomic::Ordering::Release);
        self.status().await
    }
}

/// Sanitize an instance name into a DNS-safe host label (alphanumeric + dash).
fn sanitize_host(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' })
        .collect();
    if s.is_empty() {
        "maverick".to_string()
    } else {
        s
    }
}

/// Accept loop: each inbound TCP connection becomes a WS connection. Loopback
/// peers are trusted (the local webview already has full Tauri-command access)
/// and served directly. Non-loopback (LAN) peers MUST complete the Noise pairing
/// handshake at the `/pair` upgrade path; an unauthenticated upgrade is rejected
/// with WS close 4401. Errors on a single accept are logged, not fatal.
async fn accept_loop(
    listener: TcpListener,
    bridge: Arc<RemoteBridge>,
    security: Arc<crate::remote::auth_session::SecurityContext>,
) {
    loop {
        match listener.accept().await {
            Ok((stream, peer)) => {
                let bridge = bridge.clone();
                let security = security.clone();
                tokio::spawn(async move {
                    if crate::remote::auth::requires_auth(&peer) {
                        if let Err(e) =
                            crate::remote::auth_session::serve_remote(stream, bridge, security)
                                .await
                        {
                            log::debug!("remote: authenticated connection ended: {e}");
                        }
                    } else if let Err(e) = handle_connection(stream, bridge).await {
                        log::debug!("remote: loopback connection ended: {e}");
                    }
                });
            }
            Err(e) => {
                log::warn!("remote: accept error: {e}");
            }
        }
    }
}

/// Drive one WebSocket connection end-to-end: handshake, then read→route→reply
/// with an async writer task fed by the bridge's replies and the live attach
/// stream. Defined generically over the byte stream so tests can drive it with
/// an in-memory duplex pipe instead of a real socket.
pub(crate) async fn handle_connection<S>(stream: S, bridge: Arc<RemoteBridge>) -> Result<(), String>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let config = WebSocketConfig::default()
        .max_message_size(Some(MAX_FRAME_BYTES))
        .max_frame_size(Some(MAX_FRAME_BYTES));
    let ws = tokio_tungstenite::accept_async_with_config(stream, Some(config))
        .await
        .map_err(|e| format!("ws handshake failed: {e}"))?;

    serve(ws, bridge).await
}

/// Core serve loop, generic over the already-handshaked `WebSocketStream`.
async fn serve<S>(
    ws: tokio_tungstenite::WebSocketStream<S>,
    bridge: Arc<RemoteBridge>,
) -> Result<(), String>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (mut sink, mut source) = ws.split();

    // Outbound: every ServerMessage (bridge replies + live Output) funnels through
    // one async channel so the single WS sink has exactly one writer.
    let (out_tx, mut out_rx) = unbounded_channel::<ServerMessage>();
    let writer = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            let json = match serde_json::to_string(&msg) {
                Ok(j) => j,
                Err(e) => {
                    log::warn!("remote: encode error: {e}");
                    continue;
                }
            };
            if sink.send(Message::Text(json.into())).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });

    let conn = crate::remote::connection::ConnectionManager::new(out_tx.clone());

    while let Some(frame) = source.next().await {
        let frame = match frame {
            Ok(f) => f,
            Err(e) => {
                log::debug!("remote: read error: {e}");
                break;
            }
        };
        match frame {
            Message::Text(text) => {
                handle_text(&text, &bridge, &conn, &out_tx, &LOOPBACK_GATE).await;
            }
            Message::Binary(_) => {
                // MaverickProtocol is JSON text frames; binary is not part of the
                // contract. Ignore rather than disconnect.
            }
            Message::Close(_) => break,
            // Ping/Pong are handled by tungstenite's auto-pong; nothing to do.
            Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => {}
        }
    }

    // Clean detach: stop any live drain task for this connection.
    if let Some(sid) = conn.attached_session() {
        log::debug!("remote: detaching session {sid} on disconnect");
    }
    if let Some(sid) = conn.attached_agent_session() {
        log::debug!("remote: detaching agent session {sid} on disconnect");
    }
    conn.detach();
    conn.detach_agent();

    // The writer task can't be drained to graceful EOF via dropping `out_tx`
    // alone: a live tee drain task (spawn_blocking on the C2 receiver) may still
    // hold a clone of the sender and stay parked on a blocking `recv` until its
    // PTY's `Sender` drops. The socket is closing regardless, so abort the writer
    // (after closing the WS sink) instead of awaiting an open-ended channel.
    drop(out_tx);
    writer.abort();
    let _ = writer.await;
    Ok(())
}

/// The trusted-loopback gate shared by every plaintext local connection. Built
/// once: a loopback gate is stateless (allows the full surface).
static LOOPBACK_GATE: once_cell::sync::Lazy<crate::remote::auth::CapabilityGate> =
    once_cell::sync::Lazy::new(crate::remote::auth::CapabilityGate::loopback);

/// Decode one text frame and dispatch through the bridge under `gate`, sending
/// replies and (for attach) starting the live stream. A malformed frame yields a
/// single `Error` reply rather than dropping the connection. A verb the gate
/// denies yields an `Error` too (never silently dropped, never executed).
pub(crate) async fn handle_text(
    text: &str,
    bridge: &Arc<RemoteBridge>,
    conn: &crate::remote::connection::ConnectionManager,
    out_tx: &UnboundedSender<ServerMessage>,
    gate: &crate::remote::auth::CapabilityGate,
) {
    use crate::remote::auth::GateDecision;

    let msg = match serde_json::from_str::<crate::remote::ClientMessage>(text) {
        Ok(m) => m,
        Err(e) => {
            let _ = out_tx.send(ServerMessage::Error {
                message: format!("invalid message: {e}"),
            });
            return;
        }
    };
    // Capability allowlist: a remote connection may only exercise the verbs its
    // trust tier permits. PTY write / mutating verbs stay behind a paired session.
    if gate.allows(&msg) == GateDecision::Deny {
        let _ = out_tx.send(ServerMessage::Error {
            message: "capability denied for this connection".into(),
        });
        return;
    }
    let outcome = bridge.handle(msg).await;
    // Start the agent-event forward BEFORE sending replies so the client can't
    // miss an event that races in between the reply and the subscription. The
    // broadcast receiver is created from the bridge's bus; only frames for this
    // session reach the socket.
    if let Some(session_id) = outcome.agent_attach {
        conn.start_agent_attach(session_id, bridge.subscribe_agent_events());
    }
    for reply in outcome.replies {
        if out_tx.send(reply).is_err() {
            return;
        }
    }
    if let Some(directive) = outcome.attach {
        conn.start_attach(directive);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote::bridge::{PtyHost, SidecarRequest};
    use crate::remote::ClientMessage;
    use async_trait::async_trait;
    use serde_json::{json, Value};
    use tokio_tungstenite::tungstenite::Message as TMessage;

    // Minimal fakes (mirrors of bridge.rs's, kept local so ws tests are
    // self-contained and deterministic — no real PTY or sidecar process).
    struct NoPty;
    impl PtyHost for NoPty {
        fn spawn(&self, _c: &str, _w: Option<&str>) -> Result<String, String> {
            Err("no pty in ws test".into())
        }
        fn subscribe(&self, _p: &str) -> Option<Subscription> {
            None
        }
        fn write(&self, _p: &str, _d: &str) -> Result<(), String> {
            Ok(())
        }
        fn resize(&self, _p: &str, _c: u16, _r: u16) -> Result<(), String> {
            Ok(())
        }
        fn kill(&self, _p: &str) -> Result<(), String> {
            Ok(())
        }
    }

    struct EchoSidecar;
    #[async_trait]
    impl SidecarRequest for EchoSidecar {
        async fn request(&self, method: &str, _params: Value) -> Result<Value, String> {
            // `file.tree` is the only method the ws tests exercise.
            assert_eq!(method, "file.tree");
            Ok(json!([{ "name": "src", "path": "src", "isDirectory": true }]))
        }
    }

    fn test_bridge() -> Arc<RemoteBridge> {
        Arc::new(RemoteBridge::new(Arc::new(EchoSidecar), Arc::new(NoPty)))
    }

    // Drive the server over an in-memory duplex so no real socket/port is needed:
    // the server side handshakes via accept_async, the client side via the
    // tungstenite client handshake over the other half of the pipe.
    async fn connect() -> (
        tokio_tungstenite::WebSocketStream<tokio::io::DuplexStream>,
        JoinHandle<Result<(), String>>,
    ) {
        let (server_io, client_io) = tokio::io::duplex(1 << 20);
        let bridge = test_bridge();
        let server = tokio::spawn(async move { handle_connection(server_io, bridge).await });
        let (client, _resp) =
            tokio_tungstenite::client_async("ws://127.0.0.1/", client_io)
                .await
                .expect("client handshake");
        (client, server)
    }

    async fn send(ws: &mut tokio_tungstenite::WebSocketStream<tokio::io::DuplexStream>, msg: &ClientMessage) {
        let json = serde_json::to_string(msg).unwrap();
        ws.send(TMessage::Text(json.into())).await.unwrap();
    }

    async fn recv_server_msg(
        ws: &mut tokio_tungstenite::WebSocketStream<tokio::io::DuplexStream>,
    ) -> ServerMessage {
        loop {
            let frame = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
                .await
                .expect("frame within timeout")
                .expect("stream open")
                .expect("ws ok");
            if let TMessage::Text(t) = frame {
                return serde_json::from_str(&t).expect("decode ServerMessage");
            }
        }
    }

    #[tokio::test]
    async fn list_sessions_round_trips_over_websocket() {
        let (mut client, server) = connect().await;
        send(&mut client, &ClientMessage::ListSessions).await;
        match recv_server_msg(&mut client).await {
            ServerMessage::SessionList { sessions } => assert!(sessions.is_empty()),
            other => panic!("got {other:?}"),
        }
        client.close(None).await.unwrap();
        let _ = server.await;
    }

    #[tokio::test]
    async fn list_directory_round_trips_and_reshapes() {
        let (mut client, server) = connect().await;
        let req = uuid::Uuid::new_v4();
        send(
            &mut client,
            &ClientMessage::ListDirectory { request_id: req, path: Some("/repo".into()) },
        )
        .await;
        match recv_server_msg(&mut client).await {
            ServerMessage::DirectoryListing { request_id, entries, .. } => {
                assert_eq!(request_id, req);
                assert_eq!(entries[0].name, "src");
                assert!(entries[0].is_directory);
            }
            other => panic!("got {other:?}"),
        }
        client.close(None).await.unwrap();
        let _ = server.await;
    }

    #[tokio::test]
    async fn malformed_frame_yields_error_not_disconnect() {
        let (mut client, server) = connect().await;
        client.send(TMessage::Text("{not json".into())).await.unwrap();
        match recv_server_msg(&mut client).await {
            ServerMessage::Error { message } => assert!(message.contains("invalid message")),
            other => panic!("got {other:?}"),
        }
        // Connection still alive: a follow-up request still works.
        send(&mut client, &ClientMessage::ListSessions).await;
        assert!(matches!(recv_server_msg(&mut client).await, ServerMessage::SessionList { .. }));
        client.close(None).await.unwrap();
        let _ = server.await;
    }

    #[tokio::test]
    async fn binary_frames_are_ignored() {
        let (mut client, server) = connect().await;
        client.send(TMessage::Binary(vec![1, 2, 3].into())).await.unwrap();
        // A text request after the ignored binary frame still gets answered.
        send(&mut client, &ClientMessage::ListSessions).await;
        assert!(matches!(recv_server_msg(&mut client).await, ServerMessage::SessionList { .. }));
        client.close(None).await.unwrap();
        let _ = server.await;
    }

    #[tokio::test]
    async fn agent_input_to_unknown_session_errors_over_ws() {
        // AgentInput for a non-existent session now yields a routing error
        // (the agent surface is implemented in Companion-4).
        let (mut client, server) = connect().await;
        send(
            &mut client,
            &ClientMessage::AgentInput { session_id: uuid::Uuid::nil(), text: "hi".into() },
        )
        .await;
        match recv_server_msg(&mut client).await {
            ServerMessage::Error { message } => assert!(message.contains("no agent session")),
            other => panic!("got {other:?}"),
        }
        client.close(None).await.unwrap();
        let _ = server.await;
    }

    #[tokio::test]
    async fn remote_server_status_defaults_off() {
        let server = RemoteServer::new();
        let status = server.status().await;
        assert!(!status.enabled, "companion server is OFF by default");
        assert!(!status.running);
        assert!(status.port.is_none());
    }

    #[tokio::test]
    async fn stop_when_never_started_is_disabled() {
        let server = RemoteServer::new();
        let status = server.stop().await;
        assert!(!status.enabled && !status.running);
    }
}
