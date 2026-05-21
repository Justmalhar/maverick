use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn config_load(
    state: State<'_, AppState>,
    project_path: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request("config.load", json!({ "projectPath": project_path }))
        .await
        .map_err(|e| e.to_string())
}
