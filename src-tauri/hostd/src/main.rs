//! Maverick Host daemon: headless companion server. Hosts PTY sessions and
//! serves the MaverickProtocol over WebSocket with Noise-XX pairing. No Tauri,
//! no desktop UI. The phone (Maverick Terminal) is a direct client.

use std::sync::Arc;

use clap::Parser;
use maverick_core::pty::{NoopPtySink, PtyManager};
use maverick_core::remote::bridge::{PtyHost, SidecarRequest};
use maverick_core::remote::{ManagerPtyHost, NoopSidecar, RemoteServer};

#[derive(Parser)]
#[command(name = "maverick-hostd", about = "Maverick Host — headless companion daemon")]
struct Args {
    /// Port to bind (loopback until a device is paired, then LAN). 0 lets the OS
    /// assign a free port (the bound port is logged after start).
    #[arg(long, default_value_t = 8765)]
    port: u16,
    /// Data dir rooting the device store + static identity (`<dir>/companion`).
    #[arg(long)]
    data_dir: Option<std::path::PathBuf>,
    /// Mint a pairing QR payload and print it, then keep serving.
    #[arg(long)]
    pair: bool,
}

#[tokio::main]
async fn main() -> Result<(), String> {
    env_logger::init();
    let args = Args::parse();

    let data_dir = args.data_dir.unwrap_or_else(|| {
        dirs::data_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
            .join("maverick")
    });

    let manager = Arc::new(PtyManager::new());
    let sink = Arc::new(NoopPtySink);
    let pty: Arc<dyn PtyHost> = Arc::new(ManagerPtyHost::new(manager, sink));
    let sidecar: Arc<dyn SidecarRequest> = Arc::new(NoopSidecar);

    let server = Arc::new(RemoteServer::with_deps(data_dir, pty, sidecar));

    if args.pair {
        match server.pair(None, Some("maverick-hostd".into())).await {
            // `PairingTicket::qr_payload` is the `maverick://pair/v1?...` string
            // the phone scans (a public field, not a method).
            Ok(ticket) => println!("PAIR: {}", ticket.qr_payload),
            Err(e) => eprintln!("pairing failed: {e}"),
        }
    }

    let status = server.start(Some(args.port)).await?;
    log::info!("maverick-hostd listening: {status:?}");

    // Run until killed (a LaunchAgent restarts on crash in M7). Park the main
    // task on Ctrl-C; on signal, stop the listener cleanly and exit.
    tokio::signal::ctrl_c().await.map_err(|e| e.to_string())?;
    server.stop().await;
    Ok(())
}
