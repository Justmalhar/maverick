mod bootstrap;
mod commands;
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
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let handle = app.handle().clone();
            let sink = Arc::new(TauriEventSink {
                handle: handle.clone(),
            });

            let (cmd, args, cwd) = if cfg!(debug_assertions) {
                dev_sidecar_command()
            } else {
                release_sidecar_command(&handle)
            };
            let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

            // The app must launch even when the sidecar fails — degraded mode
            // is better than a hard crash that leaves the user with a Console
            // report and no UI to explain what went wrong.
            match tauri::async_runtime::block_on(async {
                Sidecar::spawn(&cmd, &arg_refs, cwd, sink).await
            }) {
                Ok(sidecar) => {
                    log::info!("sidecar spawned: {cmd}");
                    app.manage(AppState::new(sidecar));
                }
                Err(e) => {
                    log::error!(
                        "sidecar failed to start (cmd='{cmd}'): {e:#}. UI in degraded mode."
                    );
                    app.manage(AppState::new(Sidecar::placeholder()));
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
            config_load,
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
            file_tree,
            kanban_list,
            kanban_upsert,
            preset_list,
            preset_launch,
            preset_save_current,
            mcp_start,
            mcp_stop,
            mcp_list,
            context_usage,
            attachment_create,
            automation_run,
            notify_send,
        ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { .. } = event {
            if let Some(state) = app_handle.try_state::<AppState>() {
                let sidecar = state.sidecar.clone();
                tauri::async_runtime::block_on(async move {
                    sidecar.shutdown().await;
                });
            }
        }
    });
}
