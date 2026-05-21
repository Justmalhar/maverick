use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn attachment_create(
    state: State<'_, AppState>,
    worktree_path: String,
    text: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "attachment.create",
            json!({ "worktreePath": worktree_path, "text": text }),
        )
        .await
        .map_err(|e| e.to_string())
}
