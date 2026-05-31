mod backend_detector;
mod bootstrap;
mod commands;
mod pty;
pub mod remote;
pub mod sidecar;
mod state;

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, RunEvent};

use crate::commands::*;
use crate::sidecar::{jsonrpc_event_name, NotificationSink, Sidecar};
use crate::state::AppState;

struct TauriEventSink {
    handle: AppHandle,
}

impl NotificationSink for TauriEventSink {
    fn forward(&self, method: &str, params: Value) {
        let event = jsonrpc_event_name(method);
        if let Err(e) = self.handle.emit(&event, params) {
            log::warn!("failed to emit '{event}': {e}");
        }
    }
}

fn dev_sidecar_command() -> (String, Vec<String>, Option<PathBuf>) {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| manifest_dir.clone());
    let entry = repo_root.join("sidecar").join("main.ts");
    (
        "bun".to_string(),
        vec!["run".to_string(), entry.to_string_lossy().into_owned()],
        Some(repo_root),
    )
}

fn release_sidecar_command(handle: &AppHandle) -> (String, Vec<String>, Option<PathBuf>) {
    // Tauri's externalBin resolver puts the sidecar next to the main binary
    // with the same name as configured in tauri.conf.json `externalBin`.
    // On macOS that's Contents/MacOS/<name>; on Linux/Windows it's beside the binary.
    let exe_dir = handle
        .path()
        .resource_dir()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."));
    let ext = if cfg!(windows) { ".exe" } else { "" };
    let binary = exe_dir.join(format!("maverick-sidecar{ext}"));
    (binary.to_string_lossy().into_owned(), vec![], None)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let handle = app.handle().clone();

            // Real PTYs live in the Rust core (portable-pty), independent of the sidecar.
            app.manage(crate::pty::PtyManager::new());

            // Companion WebSocket server: OFF by default. Managed here so the
            // remote_* commands can reach it, but nothing binds a listener until
            // remote_start is called explicitly. The listener stays loopback-only
            // until enabled AND a device is paired (Companion-5 QR/Noise pairing),
            // at which point it widens to the LAN behind the Noise auth gate.
            // Managed as an `Arc` so the first-pair reconcile watcher can hold a
            // cheap clone across `.await` (a borrowed `tauri::State` guard isn't
            // `Send` and can't cross the spawned task boundary).
            app.manage(std::sync::Arc::new(crate::remote::RemoteServer::new()));

            // Compute paths from OS-resolved roots (home + app-data dir).
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
            let app_data = handle
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("/tmp/maverick"));
            let paths = crate::bootstrap::MaverickPaths::from_roots(&home, &app_data);

            if let Err(e) = crate::bootstrap::ensure_dirs(&paths) {
                log::error!("ensure_dirs failed: {e}; running in degraded mode");
            }
            if let Err(e) = crate::bootstrap::seed_maverick_md(&paths) {
                log::warn!("seed_maverick_md failed: {e}");
            }

            let sink = Arc::new(TauriEventSink {
                handle: handle.clone(),
            });

            let (cmd, args, cwd) = if cfg!(debug_assertions) {
                dev_sidecar_command()
            } else {
                release_sidecar_command(&handle)
            };
            let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

            match tauri::async_runtime::block_on(async {
                Sidecar::spawn(&cmd, &arg_refs, cwd, sink).await
            }) {
                Ok(sidecar) => {
                    log::info!("sidecar spawned: {cmd}");
                    app.manage(AppState::new(sidecar, paths));
                }
                Err(e) => {
                    log::error!(
                        "sidecar failed to start (cmd='{cmd}'): {e:#}. UI in degraded mode."
                    );
                    app.manage(AppState::new(Sidecar::placeholder(), paths));
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            project_add,
            project_list,
            project_settings_get,
            project_settings_update,
            project_settings_open_file,
            workspace_list,
            workspace_create,
            workspace_destroy,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            pty_close_all,
            config_load,
            config_save,
            messages_list,
            message_append,
            skills_list,
            skills_run,
            diff_get,
            diff_stage_hunk,
            diff_unstage_hunk,
            git_log,
            git_stash_list,
            git_commit,
            git_branches,
            git_diff_stat,
            git_branch_list,
            git_checkout,
            git_blame,
            git_cherry_pick,
            git_stash_apply,
            git_stash_pop,
            git_stash_drop,
            git_conflicts,
            git_resolve_conflict,
            git_fetch,
            git_pull,
            git_push,
            file_tree,
            kanban_list,
            kanban_upsert,
            preset_list,
            preset_launch,
            preset_save_current,
            mcp_start,
            mcp_stop,
            mcp_list,
            mcp_logs,
            mcp_add,
            context_usage,
            context_record,
            attachment_create,
            automation_run,
            notify_send,
            notify_list,
            notify_mark_read,
            notify_mark_all_read,
            notify_unread_count,
            caffeinate_start,
            caffeinate_stop,
            caffeinate_status,
            instructions_resolve,
            pr_create,
            browser_open,
            browser_navigate,
            browser_set_bounds,
            browser_show,
            browser_hide,
            browser_close,
            browser_eval,
            browser_capture,
            bootstrap_status,
            bootstrap_update_settings,
            bootstrap_complete,
            reset_first_run,
            detect_backends,
            request_notification_permission,
            read_maverick_md,
            write_maverick_md,
            remote_start,
            remote_stop,
            remote_status,
            remote_pair,
            remote_devices,
            remote_revoke,
        ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { .. } = event {
            // Stop the companion listener first so no socket task outlives the app.
            if let Some(server) =
                app_handle.try_state::<std::sync::Arc<crate::remote::RemoteServer>>()
            {
                tauri::async_runtime::block_on(async move {
                    server.stop().await;
                });
            }
            if let Some(state) = app_handle.try_state::<AppState>() {
                let sidecar = state.sidecar.clone();
                tauri::async_runtime::block_on(async move {
                    sidecar.shutdown().await;
                });
            }
        }
    });
}
