use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn diff_get(
    state: State<'_, AppState>,
    worktree_path: String,
    file_path: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "diff.get",
            json!({ "worktreePath": worktree_path, "filePath": file_path }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn diff_stage_hunk(
    state: State<'_, AppState>,
    worktree_path: String,
    patch: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "diff.stage_hunk",
            json!({ "worktreePath": worktree_path, "patch": patch }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn diff_unstage_hunk(
    state: State<'_, AppState>,
    worktree_path: String,
    patch: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "diff.unstage_hunk",
            json!({ "worktreePath": worktree_path, "patch": patch }),
        )
        .await
        .map_err(|e| e.to_string())
}
