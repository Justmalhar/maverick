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

#[tauri::command]
pub async fn file_read(state: State<'_, AppState>, file_path: String) -> Result<Value, String> {
    state
        .sidecar
        .request("file.read", json!({ "filePath": file_path }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn file_search(
    state: State<'_, AppState>,
    worktree_path: String,
    query: String,
    limit: Option<u32>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "file.search",
            json!({ "worktreePath": worktree_path, "query": query, "limit": limit }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fs_watch_start(
    state: State<'_, AppState>,
    root: String,
    dirs: Option<Vec<String>>,
) -> Result<Value, String> {
    state
        .sidecar
        .request("fs.watch.start", json!({ "root": root, "dirs": dirs }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fs_watch_add(state: State<'_, AppState>, dirs: Vec<String>) -> Result<Value, String> {
    state
        .sidecar
        .request("fs.watch.add", json!({ "dirs": dirs }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fs_watch_remove(
    state: State<'_, AppState>,
    dirs: Vec<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request("fs.watch.remove", json!({ "dirs": dirs }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fs_watch_stop(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .sidecar
        .request("fs.watch.stop", json!({}))
        .await
        .map_err(|e| e.to_string())
}
