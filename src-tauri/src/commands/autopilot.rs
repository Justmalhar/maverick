use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn autopilot_list(state: State<'_, AppState>, project_id: String) -> Result<Value, String> {
    state
        .sidecar
        .request("autopilot.list", json!({ "projectId": project_id }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn autopilot_upsert(state: State<'_, AppState>, autopilot: Value) -> Result<Value, String> {
    state
        .sidecar
        .request("autopilot.upsert", json!({ "autopilot": autopilot }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn autopilot_delete(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    state
        .sidecar
        .request("autopilot.delete", json!({ "id": id }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn autopilot_run_now(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    state
        .sidecar
        .request("autopilot.runNow", json!({ "id": id }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn autopilot_webhook_info(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .sidecar
        .request("autopilot.webhookInfo", json!({}))
        .await
        .map_err(|e| e.to_string())
}
