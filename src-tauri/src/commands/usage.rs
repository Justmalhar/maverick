use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn usage_summary(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .sidecar
        .request("usage.summary", json!({}))
        .await
        .map_err(|e| e.to_string())
}
