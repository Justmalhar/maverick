use tauri::{AppHandle, Runtime, State};

use crate::remote::{RemoteServer, RemoteStatus};

/// Start the companion WebSocket server on a loopback port (defaults to 8765).
///
/// SAFETY: the server binds `127.0.0.1` only and ships disabled by default;
/// callers opt in explicitly. LAN/Tailscale exposure and pairing/auth are
/// Companion-5 — until then this is loopback-only and unauthenticated.
#[tauri::command]
pub async fn remote_start<R: Runtime>(
    app: AppHandle<R>,
    server: State<'_, RemoteServer>,
    port: Option<u16>,
) -> Result<RemoteStatus, String> {
    server.start(app, port).await
}

/// Stop the companion server and flip the persisted enabled flag to false.
#[tauri::command]
pub async fn remote_stop(server: State<'_, RemoteServer>) -> Result<RemoteStatus, String> {
    Ok(server.stop().await)
}

/// Report the companion server's enabled/running/port state for the StatusBar.
#[tauri::command]
pub async fn remote_status(server: State<'_, RemoteServer>) -> Result<RemoteStatus, String> {
    Ok(server.status().await)
}
