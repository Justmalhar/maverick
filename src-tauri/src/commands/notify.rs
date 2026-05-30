use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn notify_send(
    state: State<'_, AppState>,
    title: String,
    body: String,
    workspace_id: Option<String>,
    r#type: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "notify.send",
            json!({
                "title": title,
                "body": body,
                "workspaceId": workspace_id,
                "type": r#type,
            }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn notify_list(
    state: State<'_, AppState>,
    limit: Option<u32>,
    unread_only: Option<bool>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "notify.list",
            json!({
                "limit": limit,
                "unreadOnly": unread_only,
            }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn notify_mark_read(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    state
        .sidecar
        .request("notify.markRead", json!({ "id": id }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn notify_mark_all_read(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .sidecar
        .request("notify.markAllRead", json!({}))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn notify_unread_count(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .sidecar
        .request("notify.unreadCount", json!({}))
        .await
        .map_err(|e| e.to_string())
}
