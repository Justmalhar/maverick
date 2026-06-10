use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn workspace_create(
    state: State<'_, AppState>,
    project_id: String,
    project_path: String,
    branch: Option<String>,
    backend: String,
    base_branch: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "workspace.create",
            json!({
                "projectId": project_id,
                "projectPath": project_path,
                "branch": branch,
                "backend": backend,
                "baseBranch": base_branch,
            }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn workspace_destroy(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "workspace.destroy",
            json!({ "workspaceId": workspace_id }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn workspace_list(
    state: State<'_, AppState>,
    project_id: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request("workspace.list", json!({ "projectId": project_id }))
        .await
        .map_err(|e| e.to_string())
}
