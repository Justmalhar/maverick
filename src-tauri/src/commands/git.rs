use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn git_log(
    state: State<'_, AppState>,
    worktree_path: String,
    limit: u32,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "git.log",
            json!({ "worktreePath": worktree_path, "limit": limit }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_stash_list(
    state: State<'_, AppState>,
    worktree_path: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request("git.stash_list", json!({ "worktreePath": worktree_path }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_commit(
    state: State<'_, AppState>,
    worktree_path: String,
    message: String,
    files: Option<Vec<String>>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "git.commit",
            json!({
                "worktreePath": worktree_path,
                "message": message,
                "files": files,
            }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_branches(
    state: State<'_, AppState>,
    project_path: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request("git.branches", json!({ "projectPath": project_path }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_diff_stat(
    state: State<'_, AppState>,
    worktree_path: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request("git.diffStat", json!({ "worktreePath": worktree_path }))
        .await
        .map_err(|e| e.to_string())
}
