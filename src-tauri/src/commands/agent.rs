use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn agent_capabilities(state: State<'_, AppState>, workspace_id: String) -> Result<Value, String> {
    state
        .sidecar
        .request("agent.capabilities", json!({ "workspaceId": workspace_id }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_send(state: State<'_, AppState>, session_id: String, parts: Value) -> Result<Value, String> {
    state
        .sidecar
        .request("agent.send", json!({ "sessionId": session_id, "parts": parts }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_interrupt(state: State<'_, AppState>, session_id: String) -> Result<Value, String> {
    state
        .sidecar
        .request("agent.interrupt", json!({ "sessionId": session_id }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_queue_remove(state: State<'_, AppState>, session_id: String, queued_id: String) -> Result<Value, String> {
    state
        .sidecar
        .request("agent.queueRemove", json!({ "sessionId": session_id, "queuedId": queued_id }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_set_options(
    state: State<'_, AppState>,
    session_id: String,
    model: Option<String>,
    reasoning_level: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "agent.setOptions",
            json!({ "sessionId": session_id, "model": model, "reasoningLevel": reasoning_level }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_state(state: State<'_, AppState>, workspace_id: String) -> Result<Value, String> {
    state
        .sidecar
        .request("agent.state", json!({ "workspaceId": workspace_id }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_rewind(state: State<'_, AppState>, session_id: String, message_id: String) -> Result<Value, String> {
    state
        .sidecar
        .request("agent.rewind", json!({ "sessionId": session_id, "messageId": message_id }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_attachment_save(
    state: State<'_, AppState>,
    session_id: String,
    name: String,
    content_base64: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "agent.attachmentSave",
            json!({ "sessionId": session_id, "name": name, "contentBase64": content_base64 }),
        )
        .await
        .map_err(|e| e.to_string())
}
