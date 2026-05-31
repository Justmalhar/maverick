use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn caffeinate_start(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .sidecar
        .request("caffeinate.start", json!({}))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn caffeinate_stop(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .sidecar
        .request("caffeinate.stop", json!({}))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn caffeinate_status(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .sidecar
        .request("caffeinate.status", json!({}))
        .await
        .map_err(|e| e.to_string())
}
