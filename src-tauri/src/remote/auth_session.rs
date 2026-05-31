//! The companion security context + authenticated remote serve loop.
//!
//! [`SecurityContext`] owns the desktop static identity, the live pairing
//! registry, the persistent paired-device store, and the active-session manager.
//! It is built once per app run, rooted under `<app-data>/companion`.
//!
//! [`serve_remote`] is the auth gate at the WS upgrade for a non-loopback peer:
//!
//! 1. Accept the WS handshake only on the `/pair` path; reject anything else
//!    with WS close **4401**.
//! 2. Run the Noise_XX **responder** handshake over base64url text frames
//!    (matching the RN client's LAN pairing channel): read msg1 (verify the
//!    single-use token), send msg2, read msg3.
//! 3. TOFU-pin the client's static key against its device id. A pin mismatch
//!    aborts with 4401.
//! 4. Serve MaverickProtocol over the negotiated Noise transport, gating verbs
//!    through a paired [`CapabilityGate`]. Every inbound frame is Noise-decrypted
//!    and every reply Noise-encrypted; the bytes on the wire are ciphertext.
//!
//! The Noise channel is transport-independent: the same framing rides LAN today
//! and would ride an iroh stream unchanged (see `transport::RemoteDialer`).

use std::path::PathBuf;
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc::unbounded_channel;
use tokio::sync::Mutex as AsyncMutex;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;

use crate::remote::auth::{CapabilityGate, CLOSE_UNAUTHORIZED};
use crate::remote::bridge::RemoteBridge;
use crate::remote::connection::ConnectionManager;
use crate::remote::device_store::{DeviceStore, DeviceStoreError, PinOutcome};
use crate::remote::pairing::{
    b64url, b64url_decode, NoiseResponder, PairingError, PairingRegistry, StaticIdentity,
};
use crate::remote::ServerMessage;
use crate::remote::session_registry::SessionRegistry;

/// The WS upgrade path the client connects to for pairing + the authenticated
/// session. Mirrors the RN client's `lanPairingUrl` (`ws://host:port/pair`).
pub const PAIR_PATH: &str = "/pair";

/// What `remote_pair` returns to the UI: the session id and the QR payload string
/// to render. Serializable so it can cross the Tauri command boundary.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingTicket {
    /// The pairing-session id (for UI correlation / cancel).
    pub session_id: String,
    /// The `maverick://pair/v1?...` QR payload string.
    pub qr_payload: String,
    /// The static-key short fingerprint (matches the QR `f` and the safety number
    /// the client shows), so the desktop UI can display it alongside the QR.
    pub fingerprint: String,
}

/// Process-wide companion security context. Held in an `Arc` and shared across
/// every accepted connection.
pub struct SecurityContext {
    /// The desktop's long-lived static X25519 identity (Rust-owned, persisted).
    pub identity: StaticIdentity,
    /// Live single-use pairing sessions minted by `remote_pair`.
    pub registry: PairingRegistry,
    /// Persistent TOFU-pinned paired devices.
    pub devices: Arc<DeviceStore>,
    /// Active authenticated sessions (for revoke-driven teardown).
    pub sessions: SessionRegistry,
}

impl SecurityContext {
    /// Open (or initialize) the context under `dir` (`<app-data>/companion`).
    /// Loads the static identity, generating + persisting one on first ever run.
    pub fn open(dir: PathBuf) -> Result<Self, String> {
        let devices = Arc::new(DeviceStore::open(dir).map_err(|e| e.to_string())?);
        let identity = match devices.load_identity_private() {
            Some(private) => StaticIdentity::from_private(&private)
                .ok_or("persisted identity key is invalid")?,
            None => {
                let id = StaticIdentity::generate();
                devices
                    .save_identity_private(id.private_key())
                    .map_err(|e| e.to_string())?;
                id
            }
        };
        Ok(Self {
            identity,
            registry: PairingRegistry::new(),
            devices,
            sessions: SessionRegistry::new(),
        })
    }

    /// The desktop static-key short fingerprint (QR `f` field).
    pub fn fingerprint(&self) -> String {
        self.identity.short_fingerprint()
    }

    /// A human-ish mDNS instance name derived from the hostname + fingerprint, so
    /// multiple Macs on a LAN advertise distinct instances.
    pub fn instance_name(&self) -> String {
        let host = hostname_label();
        format!("Maverick {host} {}", self.fingerprint())
    }

    /// Mint a QR pairing session.
    pub fn mint_pairing(&self, rendezvous: Option<&str>, name: Option<&str>) -> PairingTicket {
        let (session_id, qr_payload) = self.registry.mint(&self.identity, rendezvous, name);
        PairingTicket {
            session_id: session_id.to_string(),
            qr_payload,
            fingerprint: self.fingerprint(),
        }
    }
}

/// Best-effort short hostname label for the mDNS instance name; falls back to
/// "mac" when the OS hostname is unavailable.
fn hostname_label() -> String {
    std::env::var("HOSTNAME")
        .ok()
        .or_else(|| {
            // `hostname` isn't in std; derive from the machine name env on macOS,
            // else a stable fallback. Avoids a new dependency for a cosmetic label.
            std::env::var("HOST").ok()
        })
        .map(|h| h.split('.').next().unwrap_or("mac").to_string())
        .unwrap_or_else(|| "mac".to_string())
}

/// Serve one non-loopback connection: enforce the `/pair` upgrade path, run the
/// Noise responder handshake, TOFU-pin, then serve the authenticated session over
/// the Noise transport. Generic over the byte stream so tests drive it with an
/// in-memory duplex pipe.
pub async fn serve_remote<S>(
    stream: S,
    bridge: Arc<RemoteBridge>,
    security: Arc<SecurityContext>,
) -> Result<(), String>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;
    let config = WebSocketConfig::default()
        .max_message_size(Some(MAX_FRAME_BYTES))
        .max_frame_size(Some(MAX_FRAME_BYTES));

    // Capture the request path during the upgrade so we can reject anything but
    // `/pair` before any handshake bytes flow.
    let mut path_ok = false;
    let callback = |req: &Request, resp: Response| {
        let p = req.uri().path();
        path_ok = p == PAIR_PATH;
        Ok(resp)
    };
    let ws = tokio_tungstenite::accept_hdr_async_with_config(stream, callback, Some(config))
        .await
        .map_err(|e| format!("ws handshake failed: {e}"))?;

    if !path_ok {
        return close_unauthorized(ws, "unknown upgrade path").await;
    }

    serve_paired(ws, bridge, security).await
}

/// Send a 4401 close frame and drop the connection.
async fn close_unauthorized<S>(
    mut ws: tokio_tungstenite::WebSocketStream<S>,
    reason: &str,
) -> Result<(), String>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    log::warn!("remote: rejecting unauthenticated upgrade: {reason}");
    let _ = ws
        .close(Some(CloseFrame {
            code: CloseCode::Library(CLOSE_UNAUTHORIZED),
            reason: reason.to_string().into(),
        }))
        .await;
    Err(format!("unauthorized: {reason}"))
}

/// Run the Noise handshake then serve the authenticated, encrypted session.
async fn serve_paired<S>(
    ws: tokio_tungstenite::WebSocketStream<S>,
    bridge: Arc<RemoteBridge>,
    security: Arc<SecurityContext>,
) -> Result<(), String>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (mut sink, mut source) = ws.split();

    // ---- Noise_XX responder handshake over base64url text frames ----
    let mut responder = NoiseResponder::new(&security.identity, &security.registry)
        .map_err(|e| e.to_string())?;

    // <- client msg1 (carries the single-use pairing token as its payload).
    let msg1 = recv_b64_frame(&mut source).await?;
    let msg2 = match responder.read_msg1(&msg1) {
        Ok(m) => m,
        Err(e) => return abort_handshake(sink, e).await,
    };
    send_b64_frame(&mut sink, &msg2).await?;

    // <- client msg3 (completes the handshake; yields transport keys + the
    //    client's learned static key).
    let msg3 = recv_b64_frame(&mut source).await?;
    let outcome = match responder.read_msg3(&msg3) {
        Ok(o) => o,
        Err(e) => return abort_handshake(sink, e).await,
    };

    // ---- TOFU pin: first pairing pins, a mismatch aborts (MITM kill switch) ----
    let device_id = outcome.device_id.clone();
    match security
        .devices
        .pin(&device_id, &outcome.remote_static, "")
    {
        Ok(PinOutcome::FirstUse) | Ok(PinOutcome::AlreadyPinned) => {}
        Err(DeviceStoreError::TofuMismatch) => {
            return abort_handshake(sink, PairingError::TofuMismatch).await;
        }
        Err(e) => return Err(e.to_string()),
    }

    // ---- Authenticated session over the Noise transport ----
    let transport = Arc::new(AsyncMutex::new(outcome.transport));
    let gate = CapabilityGate::paired(device_id.clone());

    // Register this session so revoke can tear it down; the guard de-registers on
    // drop. `revoked` flips true if `remote_revoke` targets this device.
    let session = security.sessions.register(&device_id);

    // Outbound: ServerMessages → JSON → Noise-encrypt → base64url text frame.
    let (out_tx, mut out_rx) = unbounded_channel::<ServerMessage>();
    let writer_transport = transport.clone();
    let writer = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            let json = match serde_json::to_string(&msg) {
                Ok(j) => j,
                Err(e) => {
                    log::warn!("remote: encode error: {e}");
                    continue;
                }
            };
            let ct = {
                let mut t = writer_transport.lock().await;
                match encrypt(&mut t, json.as_bytes()) {
                    Ok(ct) => ct,
                    Err(e) => {
                        log::warn!("remote: encrypt error: {e}");
                        continue;
                    }
                }
            };
            if sink.send(Message::Text(b64url(&ct).into())).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });

    let conn = ConnectionManager::new(out_tx.clone());

    while let Some(frame) = source.next().await {
        if session.is_revoked() {
            log::info!("remote: session for {device_id} revoked; closing");
            break;
        }
        let frame = match frame {
            Ok(f) => f,
            Err(e) => {
                log::debug!("remote: read error: {e}");
                break;
            }
        };
        match frame {
            Message::Text(text) => {
                let ct = match b64url_decode(&text) {
                    Ok(b) => b,
                    Err(e) => {
                        log::debug!("remote: non-base64url frame dropped: {e}");
                        continue;
                    }
                };
                let plain = {
                    let mut t = transport.lock().await;
                    match decrypt(&mut t, &ct) {
                        Ok(p) => p,
                        Err(e) => {
                            log::debug!("remote: decrypt failed (dropping frame): {e}");
                            continue;
                        }
                    }
                };
                match std::str::from_utf8(&plain) {
                    Ok(json) => {
                        crate::remote::ws_server::handle_text(json, &bridge, &conn, &out_tx, &gate)
                            .await;
                    }
                    Err(_) => {
                        let _ = out_tx.send(ServerMessage::Error {
                            message: "decrypted frame is not UTF-8".into(),
                        });
                    }
                }
            }
            Message::Binary(_) => {}
            Message::Close(_) => break,
            Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => {}
        }
    }

    conn.detach();
    conn.detach_agent();
    drop(out_tx);
    writer.abort();
    let _ = writer.await;
    Ok(())
}

/// Send a 4401 close after a failed handshake step and surface the error.
async fn abort_handshake<S>(
    mut sink: futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<S>,
        Message,
    >,
    err: PairingError,
) -> Result<(), String>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    log::warn!("remote: pairing aborted: {err}");
    let _ = sink
        .send(Message::Close(Some(CloseFrame {
            code: CloseCode::Library(CLOSE_UNAUTHORIZED),
            reason: err.to_string().into(),
        })))
        .await;
    let _ = sink.close().await;
    Err(err.to_string())
}

/// Receive the next text frame and base64url-decode it into raw bytes.
async fn recv_b64_frame<S>(
    source: &mut futures_util::stream::SplitStream<tokio_tungstenite::WebSocketStream<S>>,
) -> Result<Vec<u8>, String>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    loop {
        let frame = source
            .next()
            .await
            .ok_or("connection closed during handshake")?
            .map_err(|e| format!("read error during handshake: {e}"))?;
        match frame {
            Message::Text(t) => return b64url_decode(&t),
            Message::Binary(b) => return Ok(b.to_vec()),
            Message::Close(_) => return Err("client closed during handshake".into()),
            _ => continue,
        }
    }
}

/// Base64url-encode raw bytes and send them as a text frame.
async fn send_b64_frame<S>(
    sink: &mut futures_util::stream::SplitSink<tokio_tungstenite::WebSocketStream<S>, Message>,
    bytes: &[u8],
) -> Result<(), String>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    sink.send(Message::Text(b64url(bytes).into()))
        .await
        .map_err(|e| format!("send error during handshake: {e}"))
}

/// Encrypt a plaintext MaverickProtocol frame with the Noise transport. The
/// ChaCha20-Poly1305 tag adds 16 bytes; the buffer is sized accordingly.
fn encrypt(transport: &mut snow::TransportState, plain: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = vec![0u8; plain.len() + 16];
    let n = transport
        .write_message(plain, &mut out)
        .map_err(|e| e.to_string())?;
    out.truncate(n);
    Ok(out)
}

/// Decrypt a Noise transport frame back to plaintext.
fn decrypt(transport: &mut snow::TransportState, ct: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = vec![0u8; ct.len()];
    let n = transport
        .read_message(ct, &mut out)
        .map_err(|e| e.to_string())?;
    out.truncate(n);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote::pairing::{device_id_for, NOISE_PARAMS};
    use snow::params::NoiseParams;
    use tempfile::TempDir;

    fn ctx() -> (TempDir, Arc<SecurityContext>) {
        let tmp = TempDir::new().unwrap();
        let ctx = SecurityContext::open(tmp.path().join("companion")).unwrap();
        (tmp, Arc::new(ctx))
    }

    #[test]
    fn security_context_persists_identity() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("companion");
        let a = SecurityContext::open(dir.clone()).unwrap();
        let pub_a = *a.identity.public_key();
        drop(a);
        // Reopening reuses the same persisted identity.
        let b = SecurityContext::open(dir).unwrap();
        assert_eq!(*b.identity.public_key(), pub_a);
    }

    #[test]
    fn mint_pairing_returns_qr_and_fingerprint() {
        let (_tmp, ctx) = ctx();
        let ticket = ctx.mint_pairing(Some("mac.local:8765"), Some("Phone"));
        assert!(ticket.qr_payload.starts_with("maverick://pair/v1?k="));
        assert_eq!(ticket.fingerprint.len(), 8);
        assert!(ticket.qr_payload.contains(&ticket.fingerprint));
    }

    #[test]
    fn instance_name_is_dns_friendly_after_sanitize() {
        let (_tmp, ctx) = ctx();
        let name = ctx.instance_name();
        assert!(name.starts_with("Maverick "));
        assert!(name.ends_with(&ctx.fingerprint()));
    }

    // A client-side initiator + transport, mirroring the RN client, to exercise
    // the full encrypted serve loop in-memory.
    struct ClientSide {
        hs: Option<snow::HandshakeState>,
        transport: Option<snow::TransportState>,
    }

    impl ClientSide {
        fn new() -> Self {
            let kp = snow::Builder::new(NOISE_PARAMS.parse().unwrap())
                .generate_keypair()
                .unwrap();
            Self::with_key(&kp.private)
        }
        /// Build a client initiator with a fixed static private key, so its
        /// derived device id is stable across handshakes (needed to exercise the
        /// TOFU mismatch path at the serve layer).
        fn with_key(private: &[u8]) -> Self {
            let params: NoiseParams = NOISE_PARAMS.parse().unwrap();
            let hs = snow::Builder::new(params)
                .prologue(&[])
                .unwrap()
                .local_private_key(private)
                .unwrap()
                .build_initiator()
                .unwrap();
            Self { hs: Some(hs), transport: None }
        }
        fn write_msg1(&mut self, token: &[u8]) -> Vec<u8> {
            let mut buf = vec![0u8; 4096];
            let n = self.hs.as_mut().unwrap().write_message(token, &mut buf).unwrap();
            buf.truncate(n);
            buf
        }
        fn read_msg2(&mut self, m: &[u8]) {
            let mut buf = vec![0u8; 4096];
            self.hs.as_mut().unwrap().read_message(m, &mut buf).unwrap();
        }
        fn write_msg3(&mut self) -> Vec<u8> {
            let mut buf = vec![0u8; 4096];
            let n = self.hs.as_mut().unwrap().write_message(&[], &mut buf).unwrap();
            buf.truncate(n);
            buf
        }
        fn finish(&mut self) {
            let hs = self.hs.take().unwrap();
            self.transport = Some(hs.into_transport_mode().unwrap());
        }
        fn encrypt(&mut self, plain: &[u8]) -> Vec<u8> {
            super::encrypt(self.transport.as_mut().unwrap(), plain).unwrap()
        }
        fn decrypt(&mut self, ct: &[u8]) -> Vec<u8> {
            super::decrypt(self.transport.as_mut().unwrap(), ct).unwrap()
        }
    }

    #[test]
    fn encrypt_decrypt_round_trips_between_two_transports() {
        // Two snow transports from a completed XX handshake interoperate.
        let params: NoiseParams = NOISE_PARAMS.parse().unwrap();
        let kp_i = snow::Builder::new(NOISE_PARAMS.parse().unwrap()).generate_keypair().unwrap();
        let kp_r = snow::Builder::new(NOISE_PARAMS.parse().unwrap()).generate_keypair().unwrap();
        let mut ini = snow::Builder::new(params.clone()).prologue(&[]).unwrap()
            .local_private_key(&kp_i.private).unwrap().build_initiator().unwrap();
        let mut res = snow::Builder::new(params).prologue(&[]).unwrap()
            .local_private_key(&kp_r.private).unwrap().build_responder().unwrap();
        let mut b = [0u8; 4096];
        let n = ini.write_message(b"tok", &mut b).unwrap();
        let mut p = [0u8; 4096];
        res.read_message(&b[..n], &mut p).unwrap();
        let n = res.write_message(&[], &mut b).unwrap();
        ini.read_message(&b[..n], &mut p).unwrap();
        let n = ini.write_message(&[], &mut b).unwrap();
        res.read_message(&b[..n], &mut p).unwrap();
        let mut it = ini.into_transport_mode().unwrap();
        let mut rt = res.into_transport_mode().unwrap();
        let ct = encrypt(&mut it, b"hello").unwrap();
        assert_eq!(decrypt(&mut rt, &ct).unwrap(), b"hello");
        let _ = device_id_for(&kp_i.public);
    }

    #[test]
    fn client_side_helper_completes_handshake_against_responder() {
        // Sanity: the test ClientSide drives a real responder to transport mode.
        let (_tmp, ctx) = ctx();
        let ticket = ctx.mint_pairing(None, None);
        let token_str = ticket.qr_payload.split("t=").nth(1).unwrap().split('&').next().unwrap();
        let token = b64url_decode(token_str).unwrap();

        let mut responder = NoiseResponder::new(&ctx.identity, &ctx.registry).unwrap();
        let mut client = ClientSide::new();
        let msg1 = client.write_msg1(&token);
        let msg2 = responder.read_msg1(&msg1).unwrap();
        client.read_msg2(&msg2);
        let msg3 = client.write_msg3();
        let outcome = responder.read_msg3(&msg3).unwrap();
        client.finish();

        // The device gets pinned, and encrypted frames round-trip both ways.
        assert_eq!(
            ctx.devices.pin(&outcome.device_id, &outcome.remote_static, "Phone").unwrap(),
            PinOutcome::FirstUse
        );
        let mut server_t = outcome.transport;
        let req = b"{\"type\":\"list_sessions\"}";
        let ct = client.encrypt(req);
        let plain = decrypt(&mut server_t, &ct).unwrap();
        assert_eq!(plain, req);
        let reply = encrypt(&mut server_t, b"{\"type\":\"session_list\",\"sessions\":[]}").unwrap();
        assert!(!client.decrypt(&reply).is_empty());
    }

    // ---- End-to-end serve_remote over an in-memory WS duplex ----

    use crate::remote::bridge::{PtyHost, SidecarRequest};
    use crate::pty::Subscription;
    use async_trait::async_trait;
    use serde_json::{json, Value};
    use tokio::io::DuplexStream;
    use tokio_tungstenite::tungstenite::protocol::CloseFrame as TCloseFrame;
    use tokio_tungstenite::tungstenite::Message as TMessage;
    use tokio_tungstenite::WebSocketStream;

    struct NoPty;
    impl PtyHost for NoPty {
        fn spawn(&self, _c: &str, _w: Option<&str>) -> Result<String, String> {
            Err("no pty".into())
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

    struct EmptySidecar;
    #[async_trait]
    impl SidecarRequest for EmptySidecar {
        async fn request(&self, _method: &str, _params: Value) -> Result<Value, String> {
            Ok(json!([]))
        }
    }

    fn test_bridge() -> Arc<RemoteBridge> {
        Arc::new(RemoteBridge::new(Arc::new(EmptySidecar), Arc::new(NoPty)))
    }

    /// Spawn `serve_remote` on the server half of a duplex and return the client
    /// WS connected on `path`.
    async fn spawn_serve(
        ctx: Arc<SecurityContext>,
        path: &str,
    ) -> (
        WebSocketStream<DuplexStream>,
        tokio::task::JoinHandle<Result<(), String>>,
    ) {
        let (server_io, client_io) = tokio::io::duplex(1 << 20);
        let bridge = test_bridge();
        let server = tokio::spawn(async move { serve_remote(server_io, bridge, ctx).await });
        let url = format!("ws://lan.example{path}");
        let (client, _resp) = tokio_tungstenite::client_async(&url, client_io)
            .await
            .expect("client ws handshake");
        (client, server)
    }

    /// Drive the client side of the Noise handshake over the WS, returning a
    /// completed client transport ready for encrypted frames. `key` fixes the
    /// client static key (so its device id is stable) when supplied.
    async fn do_client_handshake(
        client: &mut WebSocketStream<DuplexStream>,
        ctx: &SecurityContext,
        key: Option<&[u8]>,
    ) -> ClientSide {
        let ticket = ctx.mint_pairing(None, Some("Phone"));
        let token_str = ticket.qr_payload.split("t=").nth(1).unwrap().split('&').next().unwrap();
        let token = b64url_decode(token_str).unwrap();

        let mut cs = match key {
            Some(k) => ClientSide::with_key(k),
            None => ClientSide::new(),
        };
        let msg1 = cs.write_msg1(&token);
        client.send(TMessage::Text(b64url(&msg1).into())).await.unwrap();
        let msg2 = next_b64(client).await;
        cs.read_msg2(&msg2);
        let msg3 = cs.write_msg3();
        client.send(TMessage::Text(b64url(&msg3).into())).await.unwrap();
        cs.finish();
        // Synchronize: one encrypted round-trip guarantees the server has
        // processed msg3 (pinned the device, started the transport) before the
        // caller inspects the device store / session registry.
        let req = b"{\"type\":\"list_sessions\"}";
        client.send(TMessage::Text(b64url(&cs.encrypt(req)).into())).await.unwrap();
        let _ = next_b64(client).await;
        cs
    }

    async fn next_b64(client: &mut WebSocketStream<DuplexStream>) -> Vec<u8> {
        loop {
            let f = tokio::time::timeout(std::time::Duration::from_secs(2), client.next())
                .await
                .expect("frame in time")
                .expect("stream open")
                .expect("ws ok");
            if let TMessage::Text(t) = f {
                return b64url_decode(&t).unwrap();
            }
        }
    }

    #[tokio::test]
    async fn rejects_non_pair_path_with_4401() {
        let (_tmp, ctx) = ctx();
        let (mut client, server) = spawn_serve(ctx, "/").await;
        // The server closes with 4401 before any handshake.
        let close = loop {
            match client.next().await {
                Some(Ok(TMessage::Close(Some(cf)))) => break Some(cf),
                Some(Ok(_)) => continue,
                _ => break None,
            }
        };
        let close: Option<TCloseFrame> = close;
        assert!(matches!(
            close.map(|c| u16::from(c.code)),
            Some(crate::remote::auth::CLOSE_UNAUTHORIZED)
        ));
        let _ = server.await;
    }

    #[tokio::test]
    async fn full_pairing_then_encrypted_list_sessions() {
        let (_tmp, ctx) = ctx();
        let ctx2 = ctx.clone();
        let (mut client, server) = spawn_serve(ctx2, PAIR_PATH).await;

        // Drive the encrypted handshake + first request manually so we can decrypt
        // and inspect the reply (do_client_handshake's sync round-trip discards it).
        let ticket = ctx.mint_pairing(None, Some("Phone"));
        let token_str = ticket.qr_payload.split("t=").nth(1).unwrap().split('&').next().unwrap();
        let token = b64url_decode(token_str).unwrap();
        let mut cs = ClientSide::new();
        client.send(TMessage::Text(b64url(&cs.write_msg1(&token)).into())).await.unwrap();
        let msg2 = next_b64(&mut client).await;
        cs.read_msg2(&msg2);
        client.send(TMessage::Text(b64url(&cs.write_msg3()).into())).await.unwrap();
        cs.finish();

        // First encrypted MaverickProtocol request → encrypted session_list reply.
        let req = b"{\"type\":\"list_sessions\"}";
        client.send(TMessage::Text(b64url(&cs.encrypt(req)).into())).await.unwrap();
        let reply = cs.decrypt(&next_b64(&mut client).await);
        let parsed: Value = serde_json::from_slice(&reply).unwrap();
        assert_eq!(parsed["type"], "session_list");

        // The handshake pinned exactly one device.
        assert_eq!(ctx.devices.list().len(), 1);

        client.close(None).await.unwrap();
        let _ = server.await;
    }

    #[tokio::test]
    async fn pairing_with_bad_token_aborts_4401() {
        let (_tmp, ctx) = ctx();
        // Mint a session so there IS a live token, but send the wrong one.
        let _ = ctx.mint_pairing(None, None);
        let ctx2 = ctx.clone();
        let (mut client, server) = spawn_serve(ctx2, PAIR_PATH).await;

        let mut cs = ClientSide::new();
        let msg1 = cs.write_msg1(b"definitely-not-the-token");
        client.send(TMessage::Text(b64url(&msg1).into())).await.unwrap();

        // Server aborts with a 4401 close and pins nothing.
        let mut got_close = false;
        while let Some(frame) = client.next().await {
            if let Ok(TMessage::Close(Some(cf))) = frame {
                assert_eq!(u16::from(cf.code), crate::remote::auth::CLOSE_UNAUTHORIZED);
                got_close = true;
                break;
            }
        }
        assert!(got_close, "expected a 4401 close on bad token");
        assert!(ctx.devices.list().is_empty(), "no device pinned on failed pairing");
        let _ = server.await;
    }

    #[tokio::test]
    async fn tofu_mismatch_on_repair_with_changed_key_aborts_4401() {
        let (_tmp, ctx) = ctx();
        // Fixed client key so the device id is stable across both pairings.
        let client_priv = {
            let kp = snow::Builder::new(NOISE_PARAMS.parse().unwrap()).generate_keypair().unwrap();
            kp.private
        };

        // First pairing pins device D with the client's real key.
        let ctx2 = ctx.clone();
        let (mut client, server) = spawn_serve(ctx2, PAIR_PATH).await;
        let _cs = do_client_handshake(&mut client, &ctx, Some(&client_priv)).await;
        assert_eq!(ctx.devices.list().len(), 1);
        let device_id = ctx.devices.list()[0].device_id.clone();
        client.close(None).await.unwrap();
        let _ = server.await;

        // Tamper the stored pin: same device id, a DIFFERENT pinned key. This
        // models a corrupted/forged pin row. A re-pair presenting the client's
        // real key must NOT match the tampered pin → TOFU mismatch → 4401.
        ctx.devices.revoke(&device_id).unwrap();
        ctx.devices.pin(&device_id, &[9u8; 32], "tampered").unwrap();

        let ctx3 = ctx.clone();
        let (mut client2, server2) = spawn_serve(ctx3, PAIR_PATH).await;
        let ticket = ctx.mint_pairing(None, None);
        let token_str = ticket.qr_payload.split("t=").nth(1).unwrap().split('&').next().unwrap();
        let token = b64url_decode(token_str).unwrap();
        let mut cs = ClientSide::with_key(&client_priv);
        client2.send(TMessage::Text(b64url(&cs.write_msg1(&token)).into())).await.unwrap();
        let msg2 = next_b64(&mut client2).await;
        cs.read_msg2(&msg2);
        client2.send(TMessage::Text(b64url(&cs.write_msg3()).into())).await.unwrap();

        // The server aborts with 4401 because the learned key != the tampered pin.
        let mut got_close = false;
        while let Some(frame) = client2.next().await {
            if let Ok(TMessage::Close(Some(cf))) = frame {
                assert_eq!(u16::from(cf.code), crate::remote::auth::CLOSE_UNAUTHORIZED);
                got_close = true;
                break;
            }
        }
        assert!(got_close, "expected a 4401 close on TOFU mismatch");
        // The tampered pin is unchanged (the real key was rejected, not pinned).
        assert_eq!(ctx.devices.pinned_key(&device_id).unwrap(), [9u8; 32].to_vec());
        let _ = server2.await;
    }

    #[tokio::test]
    async fn revoke_tears_down_live_session() {
        let (_tmp, ctx) = ctx();
        let ctx2 = ctx.clone();
        let (mut client, server) = spawn_serve(ctx2, PAIR_PATH).await;
        let mut cs = do_client_handshake(&mut client, &ctx, None).await;
        let device_id = ctx.devices.list()[0].device_id.clone();
        // One live authenticated session is registered.
        assert_eq!(ctx.sessions.live_count(), 1);

        // Revoke flips the session's flag; the next frame the loop reads closes it.
        assert_eq!(ctx.sessions.revoke_device(&device_id), 1);
        // Nudge the loop with one more (encrypted) frame so it observes the flag.
        let req = b"{\"type\":\"list_sessions\"}";
        let _ = client.send(TMessage::Text(b64url(&cs.encrypt(req)).into())).await;
        let _ = server.await;
        // The session handle de-registered on serve-loop exit.
        assert_eq!(ctx.sessions.live_count(), 0);
    }
}
