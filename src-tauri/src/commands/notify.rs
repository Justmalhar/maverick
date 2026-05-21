use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn notify_send(
    state: State<'_, AppState>,
    title: String,
    body: String,
    workspace_id: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "notify.send",
            json!({
                "title": title,
                "body": body,
                "workspaceId": workspace_id,
            }),
        )
        .await
        .map_err(|e| e.to_string())
}
