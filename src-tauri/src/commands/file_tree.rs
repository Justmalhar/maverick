use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn file_tree(
    state: State<'_, AppState>,
    worktree_path: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request("file.tree", json!({ "worktreePath": worktree_path }))
        .await
        .map_err(|e| e.to_string())
}
