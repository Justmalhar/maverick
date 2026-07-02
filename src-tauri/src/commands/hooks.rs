use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn hooks_claude_settings_path(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request("hooks.claudeSettingsPath", json!({ "workspaceId": workspace_id }))
        .await
        .map_err(|e| e.to_string())
}
