//! Tauri-free core of Maverick: PTY management, the companion remote protocol
//! + server, and the sidecar JSON-RPC client. Consumed by the desktop app
//! (`maverick`) and the headless daemon (`maverick-hostd`).

pub mod pty;
pub mod remote;
pub mod sidecar;
