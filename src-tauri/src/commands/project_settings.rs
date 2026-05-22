use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn project_settings_get(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request("project.settings.get", json!({ "projectId": project_id }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn project_settings_update(
    state: State<'_, AppState>,
    project_id: String,
    patch: Value,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "project.settings.update",
            json!({ "projectId": project_id, "patch": patch }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn project_settings_open_file(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "project.settings.openFile",
            json!({ "projectId": project_id }),
        )
        .await
        .map_err(|e| e.to_string())
}
