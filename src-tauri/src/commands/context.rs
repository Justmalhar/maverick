use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn context_usage(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request("context.usage", json!({ "sessionId": session_id }))
        .await
        .map_err(|e| e.to_string())
}
