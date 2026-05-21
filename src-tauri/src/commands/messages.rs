use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn messages_list(
    state: State<'_, AppState>,
    session_id: String,
    limit: u32,
    offset: u32,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "messages.list",
            json!({
                "sessionId": session_id,
                "limit": limit,
                "offset": offset,
            }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn message_append(
    state: State<'_, AppState>,
    session_id: String,
    role: String,
    content: String,
    tool_calls_json: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "messages.append",
            json!({
                "sessionId": session_id,
                "role": role,
                "content": content,
                "toolCallsJson": tool_calls_json,
            }),
        )
        .await
        .map_err(|e| e.to_string())
}
