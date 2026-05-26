use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use tauri_plugin_notification::NotificationExt;

use crate::bootstrap::{
    read_settings, seed_global_md, MaverickSettings, CURRENT_WIZARD_VERSION,
};
use crate::state::AppState;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapPaths {
    pub config_root: String,
    pub db_path: String,
    pub logs_dir: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapStatusPayload {
    pub ok: bool,
    pub error: Option<String>,
    pub first_run: bool,
    pub wizard_version: u32,
    pub current_wizard_version: u32,
    pub paths: BootstrapPaths,
    pub settings: MaverickSettings,
    pub notification_permission: String,
}

#[tauri::command]
pub async fn bootstrap_status(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<BootstrapStatusPayload, String> {
    let paths = &state.paths;
    let (ok, error, settings) = match read_settings(paths, now_ms()) {
        Ok(s) => (true, None, s),
        Err(e) => (false, Some(e.to_string()), MaverickSettings::defaults()),
    };
    // Seed GLOBAL.md best-effort (don't fail status read on it).
    let _ = seed_global_md(paths);

    let notification_permission = match app.notification().permission_state() {
        Ok(tauri_plugin_notification::PermissionState::Granted) => "granted",
        Ok(tauri_plugin_notification::PermissionState::Denied) => "denied",
        Ok(_) => "default",
        Err(_) => "unavailable",
    }
    .to_string();

    Ok(BootstrapStatusPayload {
        ok,
        error,
        first_run: settings.first_run_completed_at.is_none(),
        wizard_version: settings.wizard_version,
        current_wizard_version: CURRENT_WIZARD_VERSION,
        paths: BootstrapPaths {
            config_root: paths.config_root.to_string_lossy().into_owned(),
            db_path: paths.db_path.to_string_lossy().into_owned(),
            logs_dir: paths.logs_dir.to_string_lossy().into_owned(),
        },
        settings,
        notification_permission,
    })
}
