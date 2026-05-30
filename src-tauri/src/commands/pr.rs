use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn pr_create(
    state: State<'_, AppState>,
    worktree_path: String,
    title: Option<String>,
    body: Option<String>,
    base: Option<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "pr.create",
            json!({
                "worktreePath": worktree_path,
                "title": title,
                "body": body,
                "base": base,
            }),
        )
        .await
        .map_err(|e| e.to_string())
}
