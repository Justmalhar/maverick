use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn mcp_start(
    state: State<'_, AppState>,
    name: String,
    workspace_id: Option<String>,
    project_path: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "mcp.start",
            json!({
                "name": name,
                "workspaceId": workspace_id,
                "projectPath": project_path,
            }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_stop(state: State<'_, AppState>, name: String) -> Result<Value, String> {
    state
        .sidecar
        .request("mcp.stop", json!({ "name": name }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_list(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .sidecar
        .request("mcp.list", json!({}))
        .await
        .map_err(|e| e.to_string())
}
