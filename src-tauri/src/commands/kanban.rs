use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn kanban_list(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request("kanban.list", json!({ "projectId": project_id }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn kanban_upsert(state: State<'_, AppState>, task: Value) -> Result<Value, String> {
    state
        .sidecar
        .request("kanban.upsert", json!({ "task": task }))
        .await
        .map_err(|e| e.to_string())
}
