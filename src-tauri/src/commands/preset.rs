use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn preset_list(
    state: State<'_, AppState>,
    project_path: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request("preset.list", json!({ "projectPath": project_path }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn preset_launch(
    state: State<'_, AppState>,
    preset: Value,
    project_path: String,
    branch: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "preset.launch",
            json!({
                "preset": preset,
                "projectPath": project_path,
                "branch": branch,
            }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn preset_save_current(
    state: State<'_, AppState>,
    workspace_id: String,
    name: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "preset.save_current",
            json!({ "workspaceId": workspace_id, "name": name }),
        )
        .await
        .map_err(|e| e.to_string())
}
