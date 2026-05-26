use serde::Serialize;
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use tauri_plugin_notification::NotificationExt;

use crate::backend_detector::{detect_all, DetectedBackend};
use crate::bootstrap::{
    read_settings, seed_global_md, write_settings, MaverickSettings, CURRENT_WIZARD_VERSION,
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
        // Per spec §7: degraded mode must NOT open the wizard.
        first_run: ok && settings.first_run_completed_at.is_none(),
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

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub theme: Option<String>,
    pub default_backend: Option<String>,
    pub notifications_requested_at: Option<u64>,
}

#[tauri::command]
pub async fn bootstrap_update_settings(
    state: State<'_, AppState>,
    patch: SettingsPatch,
) -> Result<MaverickSettings, String> {
    let paths = &state.paths;
    let mut s = read_settings(paths, now_ms()).map_err(|e| e.to_string())?;
    // Wizard only ever ASSIGNS values; "missing in patch" === "don't change".
    // Explicit clearing isn't a user action in any current flow.
    if let Some(t) = patch.theme {
        s.theme = t;
    }
    if let Some(b) = patch.default_backend {
        s.default_backend = Some(b);
    }
    if let Some(n) = patch.notifications_requested_at {
        s.notifications_requested_at = Some(n);
    }
    write_settings(paths, &s).map_err(|e| e.to_string())?;
    Ok(s)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapCompletePayload {
    pub first_run_completed_at: u64,
}

#[tauri::command]
pub async fn bootstrap_complete(
    state: State<'_, AppState>,
) -> Result<BootstrapCompletePayload, String> {
    let paths = &state.paths;
    let mut s = read_settings(paths, now_ms()).map_err(|e| e.to_string())?;
    let t = now_ms();
    s.first_run_completed_at = Some(t);
    s.wizard_version = CURRENT_WIZARD_VERSION;
    write_settings(paths, &s).map_err(|e| e.to_string())?;
    Ok(BootstrapCompletePayload {
        first_run_completed_at: t,
    })
}

#[tauri::command]
pub async fn reset_first_run(state: State<'_, AppState>) -> Result<Value, String> {
    let paths = &state.paths;
    let mut s = read_settings(paths, now_ms()).map_err(|e| e.to_string())?;
    s.first_run_completed_at = None;
    write_settings(paths, &s).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn detect_backends() -> Result<Vec<DetectedBackend>, String> {
    // Spawn on a blocking thread so the 2s per-binary version probes
    // don't block the Tauri async runtime.
    tauri::async_runtime::spawn_blocking(detect_all)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn request_notification_permission(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Persist the request timestamp so we never auto-re-ask.
    let now = now_ms();
    let paths = &state.paths;
    if let Ok(mut s) = read_settings(paths, now) {
        s.notifications_requested_at = Some(now);
        let _ = write_settings(paths, &s);
    }

    match app.notification().request_permission() {
        Ok(tauri_plugin_notification::PermissionState::Granted) => Ok("granted".into()),
        Ok(tauri_plugin_notification::PermissionState::Denied) => Ok("denied".into()),
        Ok(_) => Ok("default".into()),
        Err(_) => Ok("unavailable".into()),
    }
}
