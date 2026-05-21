use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn project_add(state: State<'_, AppState>, path: String) -> Result<Value, String> {
    state
        .sidecar
        .request("project.add", json!({ "path": path }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn project_list(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .sidecar
        .request("project.list", json!({}))
        .await
        .map_err(|e| e.to_string())
}
