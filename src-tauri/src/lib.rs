mod backend_detector;
mod bootstrap;
mod commands;
#[cfg(target_os = "macos")]
mod menu;
mod pty_sink_tauri;
mod state;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, RunEvent};

use crate::commands::*;
use crate::state::AppState;
use maverick_core::sidecar::{jsonrpc_event_name, NotificationSink, Sidecar};

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
    let (program, mut args) = bun_launcher();
    args.push("run".to_string());
    args.push(entry.to_string_lossy().into_owned());
    (program, args, Some(repo_root))
}

#[cfg(windows)]
fn bun_launcher() -> (String, Vec<String>) {
    let path_var = std::env::var("PATH").unwrap_or_default();
    let home = std::env::var("USERPROFILE").ok();
    resolve_bun(&path_var, home.as_deref(), |p| p.exists())
}

#[cfg(not(windows))]
fn bun_launcher() -> (String, Vec<String>) {
    ("bun".to_string(), Vec::new())
}

/// Locate the `bun` launcher on Windows. npm installs bun as a `bun.cmd` shim
/// (plus an extensionless script) rather than a real `bun.exe`, and
/// `CreateProcessW` only appends `.exe` — it never consults `PATHEXT` — so a
/// bare `Command::new("bun")` reports "program not found". We search `PATH`
/// (then `~/.bun/bin`) for a concrete launcher: a `.exe` runs directly, while a
/// `.cmd`/`.bat` must be invoked through `cmd.exe /C` because batch files are
/// not executables. Falling back to `"bun"` preserves the original error path.
#[cfg_attr(not(windows), allow(dead_code))]
fn resolve_bun(
    path_var: &str,
    home: Option<&str>,
    exists: impl Fn(&Path) -> bool,
) -> (String, Vec<String>) {
    const CANDIDATES: [&str; 3] = ["bun.exe", "bun.cmd", "bun.bat"];
    let mut dirs: Vec<PathBuf> = path_var
        .split(';')
        .filter(|seg| !seg.is_empty())
        .map(PathBuf::from)
        .collect();
    if let Some(home) = home {
        dirs.push(Path::new(home).join(".bun").join("bin"));
    }
    for dir in &dirs {
        for name in CANDIDATES {
            let candidate = dir.join(name);
            if exists(&candidate) {
                let full = candidate.to_string_lossy().into_owned();
                return if name.ends_with(".exe") {
                    (full, Vec::new())
                } else {
                    ("cmd.exe".to_string(), vec!["/C".to_string(), full])
                };
            }
        }
    }
    ("bun".to_string(), Vec::new())
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
        // Auto-update (P3-B). `updater` exposes `plugin:updater|check/download_and_install`
        // to the webview (gated by the capability); `process` exposes
        // `plugin:process|restart` so the frontend can relaunch into the new build.
        // Desktop-only — the updater has no mobile target.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let handle = app.handle().clone();

            // Windows/Linux render their own window chrome (WindowControls), so
            // hide the native frame — otherwise the OS title bar and our custom
            // controls both show. macOS keeps its native traffic lights via
            // titleBarStyle "Overlay", so leave its decorations untouched.
            #[cfg(not(target_os = "macos"))]
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_decorations(false);
            }

            // macOS: replace the default menu so ⌘W closes the focused tab (via the
            // webview) instead of the whole window. See menu.rs.
            #[cfg(target_os = "macos")]
            {
                app.set_menu(crate::menu::build_menu(&handle)?)?;
                app.on_menu_event(|app, event| {
                    if event.id().as_ref() == crate::menu::CLOSE_TAB_ID {
                        if let Err(e) = app.emit(crate::menu::CLOSE_TAB_EVENT, ()) {
                            log::warn!("failed to emit close-tab: {e}");
                        }
                    }
                });
            }

            // Real PTYs live in the Rust core (portable-pty), independent of the sidecar.
            app.manage(std::sync::Arc::new(maverick_core::pty::PtyManager::new()));

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

            let sidecar: Arc<Sidecar> = match tauri::async_runtime::block_on(async {
                Sidecar::spawn(&cmd, &arg_refs, cwd, sink).await
            }) {
                Ok(sidecar) => {
                    log::info!("sidecar spawned: {cmd}");
                    sidecar
                }
                Err(e) => {
                    log::error!(
                        "sidecar failed to start (cmd='{cmd}'): {e:#}. UI in degraded mode."
                    );
                    Sidecar::placeholder()
                }
            };

            // Companion WebSocket server: OFF by default. Managed here so the
            // remote_* commands can reach it, but nothing binds a listener until
            // remote_start is called explicitly. The listener stays loopback-only
            // until enabled AND a device is paired (Companion-5 QR/Noise pairing),
            // at which point it widens to the LAN behind the Noise auth gate.
            // Managed as an `Arc` so the first-pair reconcile watcher can hold a
            // cheap clone across `.await` (a borrowed `tauri::State` guard isn't
            // `Send` and can't cross the spawned task boundary).
            //
            // Built with injected deps: the security dir roots the device store +
            // identity under `<app-data>/companion`; the PTY host pairs the shared
            // PtyManager with a Tauri sink so remote-spawned PTYs still tee
            // `pty:data`/`pty:exit` to the local webview; the sidecar Arc is shared
            // with AppState so file/git RPCs hit the same transport.
            let pty_manager = app
                .state::<Arc<maverick_core::pty::PtyManager>>()
                .inner()
                .clone();
            let tauri_sink: Arc<dyn maverick_core::pty::PtyEventSink> =
                Arc::new(crate::pty_sink_tauri::TauriPtySink::new(handle.clone()));
            let pty_host: Arc<dyn maverick_core::remote::bridge::PtyHost> =
                Arc::new(maverick_core::remote::ManagerPtyHost::new(pty_manager, tauri_sink));
            let sidecar_for_remote: Arc<dyn maverick_core::remote::bridge::SidecarRequest> =
                sidecar.clone();
            app.manage(std::sync::Arc::new(maverick_core::remote::RemoteServer::with_deps(
                paths.app_data_dir.clone(),
                pty_host,
                sidecar_for_remote,
            )));

            app.manage(AppState::new(sidecar, paths));
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
            wsl_available,
            config_load,
            config_save,
            messages_list,
            message_append,
            skills_list,
            skills_run,
            skills_list_global,
            skills_create_global,
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
            git_remote_info,
            file_read_at_ref,
            git_discard_file,
            ai_commit_message,
            ai_branch_name,
            git_credential_status,
            git_credential_connect,
            git_credential_disconnect,
            file_tree,
            file_read,
            file_write,
            file_search,
            fs_watch_start,
            fs_watch_add,
            fs_watch_remove,
            fs_watch_stop,
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
            usage_summary,
            attachment_create,
            automation_run,
            automation_activate_triggers,
            automation_deactivate_triggers,
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
            checks_get,
            agent_run,
            agent_kill,
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
                app_handle.try_state::<std::sync::Arc<maverick_core::remote::RemoteServer>>()
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

#[cfg(test)]
mod tests {
    use super::resolve_bun;
    use std::collections::HashSet;
    use std::path::{Path, PathBuf};

    fn exists_in(present: &[&str]) -> impl Fn(&Path) -> bool {
        let set: HashSet<PathBuf> = present.iter().map(PathBuf::from).collect();
        move |p: &Path| set.contains(p)
    }

    #[test]
    fn prefers_a_real_exe_and_runs_it_directly() {
        let (program, args) = resolve_bun(
            r"C:\bin;C:\tools",
            None,
            exists_in(&[r"C:\tools\bun.exe"]),
        );
        assert_eq!(program, r"C:\tools\bun.exe");
        assert!(args.is_empty());
    }

    #[test]
    fn wraps_a_cmd_shim_through_cmd_exe() {
        let (program, args) = resolve_bun(
            r"C:\npm",
            None,
            exists_in(&[r"C:\npm\bun.cmd"]),
        );
        assert_eq!(program, "cmd.exe");
        assert_eq!(args, vec!["/C".to_string(), r"C:\npm\bun.cmd".to_string()]);
    }

    #[test]
    fn wraps_a_bat_shim_through_cmd_exe() {
        let (program, args) = resolve_bun(r"C:\npm", None, exists_in(&[r"C:\npm\bun.bat"]));
        assert_eq!(program, "cmd.exe");
        assert_eq!(args, vec!["/C".to_string(), r"C:\npm\bun.bat".to_string()]);
    }

    #[test]
    fn exe_on_path_wins_over_later_cmd_shim() {
        let (program, _) = resolve_bun(
            r"C:\real;C:\npm",
            None,
            exists_in(&[r"C:\real\bun.exe", r"C:\npm\bun.cmd"]),
        );
        assert_eq!(program, r"C:\real\bun.exe");
    }

    #[test]
    fn falls_back_to_home_bun_bin_when_not_on_path() {
        let (program, args) = resolve_bun(
            r"C:\bin",
            Some(r"C:\Users\me"),
            exists_in(&[r"C:\Users\me\.bun\bin\bun.exe"]),
        );
        assert_eq!(program, r"C:\Users\me\.bun\bin\bun.exe");
        assert!(args.is_empty());
    }

    #[test]
    fn falls_back_to_bare_bun_when_nothing_found() {
        let (program, args) = resolve_bun(r"C:\bin", Some(r"C:\Users\me"), exists_in(&[]));
        assert_eq!(program, "bun");
        assert!(args.is_empty());
    }

    #[test]
    fn ignores_empty_path_segments() {
        let (program, _) = resolve_bun(r";;C:\npm;", None, exists_in(&[r"C:\npm\bun.cmd"]));
        assert_eq!(program, "cmd.exe");
    }
}
