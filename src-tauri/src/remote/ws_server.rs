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

use std::net::{Ipv4Addr, SocketAddr};
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
struct Running {
    addr: SocketAddr,
    accept_task: JoinHandle<()>,
    hook: Option<crate::remote::hook_server::HookListenerHandle>,
}

/// Snapshot of the server for the `remote_status` command.
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct RemoteStatus {
    /// The persisted opt-in (defaults false until Companion-5 adds auth).
    pub enabled: bool,
    /// Whether a listener is currently bound.
    pub running: bool,
    /// The bound loopback port, when running.
    pub port: Option<u16>,
}

/// Process-wide companion-server controller held in Tauri state. Owns the
/// enabled flag and the (at most one) running listener.
pub struct RemoteServer {
    enabled: std::sync::atomic::AtomicBool,
    running: Mutex<Option<Running>>,
}

impl Default for RemoteServer {
    fn default() -> Self {
        Self::new()
    }
}

impl RemoteServer {
    pub fn new() -> Self {
        Self {
            // OFF by default: stays disabled until Companion-5 wires auth.
            enabled: std::sync::atomic::AtomicBool::new(false),
            running: Mutex::new(None),
        }
    }

    pub async fn status(&self) -> RemoteStatus {
        let guard = self.running.lock().await;
        RemoteStatus {
            enabled: self.enabled.load(std::sync::atomic::Ordering::Acquire),
            running: guard.is_some(),
            port: guard.as_ref().map(|r| r.addr.port()),
        }
    }

    /// Bind a loopback listener on `port` (0 = OS-assigned) and start accepting.
    /// Idempotent-ish: if already running, returns the current status without
    /// rebinding. Flips the persisted `enabled` flag to true.
    pub async fn start<R: Runtime>(
        &self,
        app: AppHandle<R>,
        port: Option<u16>,
    ) -> Result<RemoteStatus, String> {
        let mut guard = self.running.lock().await;
        if guard.is_some() {
            self.enabled.store(true, std::sync::atomic::Ordering::Release);
            drop(guard);
            return Ok(self.status().await);
        }

        let bind = SocketAddr::from((Ipv4Addr::LOCALHOST, port.unwrap_or(DEFAULT_PORT)));
        let listener = TcpListener::bind(bind)
            .await
            .map_err(|e| format!("failed to bind {bind}: {e}"))?;
        let addr = listener.local_addr().map_err(|e| e.to_string())?;

        // Build the bridge once; it is shared (Arc) across every accepted socket
        // so the session registry is process-wide, like the desktop PtyManager.
        let sidecar: Arc<dyn SidecarRequest> = {
            let state = app
                .try_state::<AppState>()
                .ok_or("app state unavailable")?;
            state.inner().sidecar.clone()
        };
        let pty: Arc<dyn PtyHost> = Arc::new(ManagedPty { app: app.clone() });
        let bridge = Arc::new(RemoteBridge::new(sidecar, pty));

        // Bind the Claude hook bridge on 127.0.0.1:7789 and merge the hook config
        // into ~/.claude/settings.json (idempotent, non-clobbering). A bind
        // failure (e.g. port already taken) is non-fatal: chat-mode stream-json
        // events still flow; only the hook-driven lifecycle events are lost.
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

        let accept_task = tokio::spawn(accept_loop(listener, bridge));

        *guard = Some(Running { addr, accept_task, hook });
        self.enabled.store(true, std::sync::atomic::Ordering::Release);
        drop(guard);
        Ok(self.status().await)
    }

    /// Stop accepting and flip `enabled` to false. In-flight per-socket tasks
    /// observe their stream closing as the listener drops. Idempotent.
    pub async fn stop(&self) -> RemoteStatus {
        if let Some(running) = self.running.lock().await.take() {
            running.accept_task.abort();
            if let Some(hook) = running.hook {
                hook.shutdown();
            }
        }
        self.enabled.store(false, std::sync::atomic::Ordering::Release);
        self.status().await
    }
}

/// Accept loop: each inbound TCP connection becomes a WS connection driven by
/// `handle_connection`. Errors on a single accept are logged, not fatal.
async fn accept_loop(listener: TcpListener, bridge: Arc<RemoteBridge>) {
    loop {
        match listener.accept().await {
            Ok((stream, peer)) => {
                // Belt-and-suspenders: only ever serve loopback peers even if the
                // bind somehow widened. Drop anything non-local without a handshake.
                if !peer.ip().is_loopback() {
                    log::warn!("remote: refusing non-loopback peer {peer}");
                    continue;
                }
                let bridge = bridge.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(stream, bridge).await {
                        log::debug!("remote: connection ended: {e}");
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
                handle_text(&text, &bridge, &conn, &out_tx).await;
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

/// Decode one text frame and dispatch through the bridge, sending replies and
/// (for attach) starting the live stream. A malformed frame yields a single
/// `Error` reply rather than dropping the connection.
async fn handle_text(
    text: &str,
    bridge: &Arc<RemoteBridge>,
    conn: &crate::remote::connection::ConnectionManager,
    out_tx: &UnboundedSender<ServerMessage>,
) {
    let msg = match serde_json::from_str::<crate::remote::ClientMessage>(text) {
        Ok(m) => m,
        Err(e) => {
            let _ = out_tx.send(ServerMessage::Error {
                message: format!("invalid message: {e}"),
            });
            return;
        }
    };
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
