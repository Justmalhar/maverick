use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn squad_list(state: State<'_, AppState>, project_id: String) -> Result<Value, String> {
    state
        .sidecar
        .request("squad.list", json!({ "projectId": project_id }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn squad_upsert(state: State<'_, AppState>, squad: Value) -> Result<Value, String> {
    state
        .sidecar
        .request("squad.upsert", json!({ "squad": squad }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn squad_delete(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    state
        .sidecar
        .request("squad.delete", json!({ "id": id }))
        .await
        .map_err(|e| e.to_string())
}
