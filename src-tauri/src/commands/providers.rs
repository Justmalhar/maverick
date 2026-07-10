use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn list_ollama_models(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .sidecar
        .request("providers.listOllamaModels", json!({}))
        .await
        .map_err(|e| e.to_string())
}
