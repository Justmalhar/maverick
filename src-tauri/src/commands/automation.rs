use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn automation_run(
    state: State<'_, AppState>,
    automation_name: String,
    workspace_id: Option<String>,
    project_path: Option<String>,
    worktree_path: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "automation.run",
            json!({
                "automationName": automation_name,
                "workspaceId": workspace_id,
                "projectPath": project_path,
                "worktreePath": worktree_path,
            }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn automation_activate_triggers(
    state: State<'_, AppState>,
    workspace_id: String,
    project_path: String,
    worktree_path: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "automation.activateTriggers",
            json!({
                "workspaceId": workspace_id,
                "projectPath": project_path,
                "worktreePath": worktree_path,
            }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn automation_deactivate_triggers(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "automation.deactivateTriggers",
            json!({ "workspaceId": workspace_id }),
        )
        .await
        .map_err(|e| e.to_string())
}
