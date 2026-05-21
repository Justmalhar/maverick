use serde_json::{json, Value};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub async fn pty_spawn(
    state: State<'_, AppState>,
    workspace_id: String,
    command: String,
    args: Vec<String>,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "pty.spawn",
            json!({
                "workspaceId": workspace_id,
                "command": command,
                "args": args,
            }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pty_write(
    state: State<'_, AppState>,
    pty_id: String,
    data: String,
) -> Result<Value, String> {
    state
        .sidecar
        .request("pty.write", json!({ "ptyId": pty_id, "data": data }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pty_resize(
    state: State<'_, AppState>,
    pty_id: String,
    cols: u16,
    rows: u16,
) -> Result<Value, String> {
    state
        .sidecar
        .request(
            "pty.resize",
            json!({ "ptyId": pty_id, "cols": cols, "rows": rows }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pty_kill(state: State<'_, AppState>, pty_id: String) -> Result<Value, String> {
    state
        .sidecar
        .request("pty.kill", json!({ "ptyId": pty_id }))
        .await
        .map_err(|e| e.to_string())
}
