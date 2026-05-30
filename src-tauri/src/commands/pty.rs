use std::collections::HashMap;

use serde_json::{json, Value};
use tauri::{AppHandle, Runtime, State};

use crate::pty::{PtyManager, SpawnParams};

#[tauri::command]
pub async fn pty_spawn<R: Runtime>(
    app: AppHandle<R>,
    manager: State<'_, PtyManager>,
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<Value, String> {
    let pty_id = manager.spawn(
        &app,
        SpawnParams {
            command,
            args,
            cwd,
            env,
            cols: cols.unwrap_or(80),
            rows: rows.unwrap_or(24),
        },
    )?;
    Ok(json!({ "ptyId": pty_id }))
}

#[tauri::command]
pub async fn pty_write(
    manager: State<'_, PtyManager>,
    pty_id: String,
    data: String,
) -> Result<Value, String> {
    manager.write(&pty_id, &data)?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn pty_resize(
    manager: State<'_, PtyManager>,
    pty_id: String,
    cols: u16,
    rows: u16,
) -> Result<Value, String> {
    manager.resize(&pty_id, cols, rows)?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn pty_kill(manager: State<'_, PtyManager>, pty_id: String) -> Result<Value, String> {
    manager.kill(&pty_id)?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub async fn pty_close_all(manager: State<'_, PtyManager>) -> Result<Value, String> {
    manager.close_all()?;
    Ok(json!({ "ok": true }))
}
