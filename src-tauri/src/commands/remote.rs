use std::sync::Arc;

use tauri::{AppHandle, Runtime, State};

use crate::remote::auth_session::PairingTicket;
use crate::remote::{PairedDevice, RemoteServer, RemoteStatus};

/// Start the companion WebSocket server.
///
/// SAFETY: the listener binds loopback by default and only widens to the LAN
/// (`0.0.0.0` + `_maverick._tcp` mDNS) once the server is enabled AND at least
/// one device has been paired (Companion-5). Every off-box connection must still
/// complete the Noise_XX pairing handshake at `/pair` or it is rejected (4401).
/// Disabled by default; callers opt in explicitly.
#[tauri::command]
pub async fn remote_start<R: Runtime>(
    app: AppHandle<R>,
    server: State<'_, Arc<RemoteServer>>,
    port: Option<u16>,
) -> Result<RemoteStatus, String> {
    server.start(app, port).await
}

/// Stop the companion server (also stops the mDNS advertiser) and flip the
/// persisted enabled flag to false.
#[tauri::command]
pub async fn remote_stop(server: State<'_, RemoteServer>) -> Result<RemoteStatus, String> {
    Ok(server.stop().await)
}

/// Report the companion server's enabled/running/port/LAN/paired state.
#[tauri::command]
pub async fn remote_status(server: State<'_, RemoteServer>) -> Result<RemoteStatus, String> {
    Ok(server.status().await)
}

/// Mint a single-use QR pairing session and return its `maverick://pair/v1?...`
/// payload + fingerprint for the desktop to render. No API keys: the payload
/// carries only the desktop static PUBLIC key, an ephemeral public hint, and a
/// 128-bit single-use token — never a private key or bearer credential.
#[tauri::command]
pub async fn remote_pair<R: Runtime>(
    app: AppHandle<R>,
    server: State<'_, Arc<RemoteServer>>,
    rendezvous: Option<String>,
    name: Option<String>,
) -> Result<PairingTicket, String> {
    server.pair(app, rendezvous, name).await
}

/// List the TOFU-pinned paired companion devices.
#[tauri::command]
pub async fn remote_devices<R: Runtime>(
    app: AppHandle<R>,
    server: State<'_, Arc<RemoteServer>>,
) -> Result<Vec<PairedDevice>, String> {
    server.devices(app).await
}

/// Revoke a paired device by id: deletes its pinned row, tears down its live
/// sessions, and narrows the listener back to loopback if it was the last device.
/// Returns whether a device was removed.
#[tauri::command]
pub async fn remote_revoke<R: Runtime>(
    app: AppHandle<R>,
    server: State<'_, Arc<RemoteServer>>,
    device_id: String,
) -> Result<bool, String> {
    server.revoke(app, device_id).await
}
