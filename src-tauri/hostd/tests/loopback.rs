//! End-to-end: start a headless RemoteServer on an ephemeral loopback port,
//! connect a real WebSocket client, and exercise the terminal happy path:
//! list_sessions (empty) -> create_session -> session_created with an id.
//!
//! Loopback peers (127.0.0.1) are trusted by the server and served the plaintext
//! MaverickProtocol directly (no Noise handshake) — see `ws_server::accept_loop`
//! and `auth::requires_auth`. So the client speaks the JSON wire shape verbatim.

use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use maverick_core::pty::{NoopPtySink, PtyManager};
use maverick_core::remote::bridge::{PtyHost, SidecarRequest};
use maverick_core::remote::{ManagerPtyHost, NoopSidecar, RemoteServer};
use tokio_tungstenite::tungstenite::Message;

async fn start_server() -> (Arc<RemoteServer>, u16) {
    let manager = Arc::new(PtyManager::new());
    let pty: Arc<dyn PtyHost> = Arc::new(ManagerPtyHost::new(manager, Arc::new(NoopPtySink)));
    let sidecar: Arc<dyn SidecarRequest> = Arc::new(NoopSidecar);
    let dir = std::env::temp_dir().join(format!("mav-hostd-{}", uuid::Uuid::new_v4()));
    let server = Arc::new(RemoteServer::with_deps(dir, pty, sidecar));
    // Port 0 → OS picks a free port; read it back from the returned status.
    let status = server.start(Some(0)).await.expect("start");
    (server.clone(), status.port.expect("bound port"))
}

#[tokio::test]
async fn terminal_happy_path_over_loopback() {
    let (server, port) = start_server().await;
    let url = format!("ws://127.0.0.1:{port}/");
    let (mut ws, _) = tokio_tungstenite::connect_async(url).await.expect("connect");

    // list_sessions -> empty
    ws.send(Message::Text(r#"{"type":"list_sessions"}"#.into()))
        .await
        .unwrap();
    let reply = wait_for_type(&mut ws, "session_list").await;
    assert!(
        reply["sessions"].as_array().unwrap().is_empty(),
        "no sessions before any create"
    );

    // create_session -> session_created carrying a SessionInfo with a UUID id.
    // `shell` runs a real PTY via ManagerPtyHost -> PtyManager::spawn.
    ws.send(Message::Text(
        r#"{"type":"create_session","name":"t","shell":"/bin/sh"}"#.into(),
    ))
    .await
    .unwrap();
    let created = wait_for_type(&mut ws, "session_created").await;
    let id = created["session"]["id"]
        .as_str()
        .expect("session_created carries a session id");
    assert!(
        uuid::Uuid::parse_str(id).is_ok(),
        "session id is a UUID string, got {id:?}"
    );

    server.stop().await;
}

type Ws = tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
>;

async fn next_json(ws: &mut Ws) -> serde_json::Value {
    loop {
        let msg = tokio::time::timeout(std::time::Duration::from_secs(5), ws.next())
            .await
            .expect("timeout waiting for frame")
            .expect("stream open")
            .expect("ws ok");
        if let Message::Text(t) = msg {
            return serde_json::from_str(&t).expect("server frame is JSON");
        }
    }
}

async fn wait_for_type(ws: &mut Ws, ty: &str) -> serde_json::Value {
    loop {
        let v = next_json(ws).await;
        // Surface a protocol error rather than spinning until the timeout.
        if v["type"] == "error" {
            panic!("server returned error while awaiting {ty:?}: {v}");
        }
        if v["type"] == ty {
            return v;
        }
    }
}
