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

#[tauri::command]
pub async fn git_branch_list(
    state: State<'_, AppState>,
    worktree_path: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request("git.branch_list", json!({ "worktreePath": worktree_path }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_checkout(
    state: State<'_, AppState>,
    worktree_path: String,
    branch: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "git.checkout",
            json!({ "worktreePath": worktree_path, "branch": branch }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_blame(
    state: State<'_, AppState>,
    worktree_path: String,
    file_path: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "git.blame",
            json!({ "worktreePath": worktree_path, "filePath": file_path }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_cherry_pick(
    state: State<'_, AppState>,
    worktree_path: String,
    sha: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "git.cherry_pick",
            json!({ "worktreePath": worktree_path, "sha": sha }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_stash_apply(
    state: State<'_, AppState>,
    worktree_path: String,
    index: u32,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "git.stash_apply",
            json!({ "worktreePath": worktree_path, "index": index }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_stash_pop(
    state: State<'_, AppState>,
    worktree_path: String,
    index: u32,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "git.stash_pop",
            json!({ "worktreePath": worktree_path, "index": index }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_stash_drop(
    state: State<'_, AppState>,
    worktree_path: String,
    index: u32,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "git.stash_drop",
            json!({ "worktreePath": worktree_path, "index": index }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_conflicts(
    state: State<'_, AppState>,
    worktree_path: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request("git.conflicts", json!({ "worktreePath": worktree_path }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_resolve_conflict(
    state: State<'_, AppState>,
    worktree_path: String,
    file_path: String,
    hunk_index: u32,
    resolution: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "git.resolve_conflict",
            json!({
                "worktreePath": worktree_path,
                "filePath": file_path,
                "hunkIndex": hunk_index,
                "resolution": resolution,
            }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_fetch(
    state: State<'_, AppState>,
    worktree_path: String,
    remote: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "git.fetch",
            json!({ "worktreePath": worktree_path, "remote": remote }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_pull(
    state: State<'_, AppState>,
    worktree_path: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request("git.pull", json!({ "worktreePath": worktree_path }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_push(
    state: State<'_, AppState>,
    worktree_path: String,
    remote: Option<String>,
    branch: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "git.push",
            json!({
                "worktreePath": worktree_path,
                "remote": remote,
                "branch": branch,
            }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_remote_info(
    state: State<'_, AppState>,
    worktree_path: String,
    remote: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "git.remote_info",
            json!({ "worktreePath": worktree_path, "remote": remote }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ai_commit_message(
    state: State<'_, AppState>,
    worktree_path: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request("ai.commit_message", json!({ "worktreePath": worktree_path }))
        .await
        .map_err(|e| e.to_string())
}
