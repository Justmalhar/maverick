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
