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

#[tauri::command]
pub async fn mcp_logs(
    state: State<'_, AppState>,
    name: String,
    since_offset: Option<u64>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "mcp.logs",
            json!({ "name": name, "sinceOffset": since_offset }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_add(
    state: State<'_, AppState>,
    name: String,
    command: String,
    args: Vec<String>,
    env: Option<std::collections::HashMap<String, String>>,
    workspace_id: Option<String>,
    project_path: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "mcp.add",
            json!({
                "name": name,
                "command": command,
                "args": args,
                "env": env,
                "workspaceId": workspace_id,
                "projectPath": project_path,
            }),
        )
        .await
        .map_err(|e| e.to_string())
}
