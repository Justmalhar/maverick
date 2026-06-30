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
pub async fn git_branch_create(
    state: State<'_, AppState>,
    worktree_path: String,
    name: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "git.branch_create",
            json!({ "worktreePath": worktree_path, "name": name }),
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
pub async fn file_read_at_ref(
    state: State<'_, AppState>,
    worktree_path: String,
    file_path: String,
    r#ref: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "file.readAtRef",
            json!({ "worktreePath": worktree_path, "filePath": file_path, "ref": r#ref }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_discard_file(
    state: State<'_, AppState>,
    worktree_path: String,
    file_path: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "git.discard_file",
            json!({ "worktreePath": worktree_path, "filePath": file_path }),
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
    backend: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request_with_timeout(
            "ai.commit_message",
            json!({ "worktreePath": worktree_path, "backend": backend }),
            std::time::Duration::from_secs(180),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ai_branch_name(
    state: State<'_, AppState>,
    prompt: String,
    cwd: Option<String>,
    instructions: Option<String>,
    backend: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request_with_timeout(
            "ai.branch_name",
            json!({ "prompt": prompt, "cwd": cwd, "instructions": instructions, "backend": backend }),
            std::time::Duration::from_secs(60),
        )
        .await
        .map_err(|e| e.to_string())
}

/// Name a branch from the work already done in the worktree (last commit + diff).
/// Long-running (invokes the agent CLI), so it gets the extended timeout.
#[tauri::command]
pub async fn ai_branch_name_from_diff(
    state: State<'_, AppState>,
    cwd: String,
    instructions: Option<String>,
    backend: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request_with_timeout(
            "ai.branch_name_from_diff",
            json!({ "cwd": cwd, "instructions": instructions, "backend": backend }),
            std::time::Duration::from_secs(60),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_rename_branch(
    state: State<'_, AppState>,
    worktree_path: String,
    new_branch: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "git.rename_branch",
            json!({ "worktreePath": worktree_path, "newBranch": new_branch }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_credential_status(
    state: State<'_, AppState>,
    provider: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request("git.credential_status", json!({ "provider": provider }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_credential_connect(
    state: State<'_, AppState>,
    provider: String,
    username: String,
    password: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request_with_timeout(
            "git.credential_connect",
            json!({ "provider": provider, "username": username, "password": password }),
            std::time::Duration::from_secs(30),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_credential_disconnect(
    state: State<'_, AppState>,
    provider: String,
    username: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "git.credential_disconnect",
            json!({ "provider": provider, "username": username }),
        )
        .await
        .map_err(|e| e.to_string())
}
